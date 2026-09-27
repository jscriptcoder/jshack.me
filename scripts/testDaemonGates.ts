// Wire-payload smoke for D4 slice 3 — a stopped daemon is a shut door on EVERY login
// endpoint, including for a client that skips the client-side check. Drives the REAL
// /api/sessions endpoints (authCreateSession + authCreateSessionSameLan) and the REAL
// /api/patches removePatch against a running `vercel dev` + supabase.
//
// The two gates this proves live (the locally-untypechecked api/ runtime):
//   - own-LAN `authCreateSession`: an `ssh`-kind login onto a generated host running no
//     sshd is 404 service_not_running. It used to succeed — `ssh` was exempt from the
//     running-service gate that `ftp` and `scp` always obeyed.
//   - same-LAN `authCreateSessionSameLan`: an `ssh` to a port serving VSFTPD is refused.
//     It used to open an ssh session through an ftp port, because the gate compared the
//     port and not the service.
//
// Both refusals are asserted with a WRONG password on purpose: a 404 where a live daemon
// would give 401 proves the service gate fires BEFORE any credential is read, and the
// 401 control proves the gate discriminates on the daemon rather than shutting the door
// on everyone.
//
// The last check is the loop D4 exists for: B is in, A runs `systemctl stop sshd` (the
// same signed removePatch the command issues), and B is refused on the next knock.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testDaemonGates.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { lanAddressFor } from '../src/core/network/lanAddress';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { buildRemoteHostFs } from '../src/core/generation/remoteHostFs';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import { formatPidfileContent, readOpenPorts } from '../src/core/services/pidfile';
import { SERVICE_CATALOG, type ServiceSpec } from '../src/core/services/serviceCatalog';
import { md5 } from '../src/core/generation/md5';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';

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

const errorOf = (body: unknown): string | undefined => (body as { error?: string } | null)?.error;

// --- Identities: A (the target/owner), B (a fellow occupant). ---
const alice = generateIdentity();
const bob = generateIdentity();

const ESSID = 'DAEMON-GATE-WIFI';
const A_WS_NAME = 'skylab';
const B_WS_NAME = 'nebuchadnezzar';
const A_WS = computeWorkstationId(A_WS_NAME, alice.publicKeyHex);
const A_OCTET = 11;
const B_OCTET = 12;
const A_LAN = lanAddressFor(ESSID, A_OCTET);
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex);
const WRONG_PW = 'not-the-password-at-all';

const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };

// --- Own-LAN targets, resolved the way the server will: a generated host that runs
//     sshd, and one that does not. Only ~40% of hosts roll ssh, so both exist. ---
const machineServing = (serves: boolean): LanHost => {
  const match = generateHomeLan(ESSID).hosts.find(
    (host) =>
      host.kind === 'machine' &&
      readOpenPorts(buildRemoteHostFs(ESSID, host)).some(
        (open) => open.service === SERVICE_CATALOG.ssh.service,
      ) === serves,
  );
  if (match === undefined) throw new Error(`no generated host ${serves ? 'with' : 'without'} sshd`);
  return match;
};

const withSshd = machineServing(true);
const withoutSshd = machineServing(false);

const pidfileRow = (port: number, spec: ServiceSpec) => ({
  machine_id: A_WS,
  path: `/var/run/${spec.pidfile}`,
  content: formatPidfileContent(spec, port),
  owner: 'root',
  permissions: WORLD_PID,
  node_type: 'file',
  writer_key: alice.publicKeyHex,
  updated_at: new Date().toISOString(),
  is_new: true,
});

const occupancyRow = (owner: ReturnType<typeof generateIdentity>, wsName: string) => ({
  essid: ESSID,
  owner_key: owner.publicKeyHex,
  workstation_machine_id: computeWorkstationId(wsName, owner.publicKeyHex),
  workstation_username: 'player',
  workstation_machine_name: wsName,
  workstation_root_hash: md5('root-secret'),
});

const cleanup = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  await sr.from('patches').delete().eq('machine_id', A_WS);
  for (const id of [alice, bob]) {
    await sr.from('sessions').delete().eq('player_key', id.publicKeyHex);
  }
  for (const host of [withSshd, withoutSshd]) {
    await sr.from('patches').delete().eq('machine_id', hostMachineId(host, ESSID));
  }
};

await cleanup();
await sr
  .from('home_network_occupants')
  .insert([occupancyRow(alice, A_WS_NAME), occupancyRow(bob, B_WS_NAME)]);
await sr.from('network_lan_leases').insert([
  { essid: ESSID, owner_key: alice.publicKeyHex, octet: A_OCTET },
  { essid: ESSID, owner_key: bob.publicKeyHex, octet: B_OCTET },
]);

const ownLan = (target: LanHost, fields: Record<string, unknown>) =>
  signRequest(alice, 'authCreateSession', {
    essid: ESSID,
    target_ip: target.ip,
    username: 'root',
    password: WRONG_PW,
    ...fields,
  });

const sameLan = (fields: Record<string, unknown>) =>
  signRequest(bob, 'authCreateSessionSameLan', {
    essid: ESSID,
    target_ip: A_LAN,
    ...fields,
  });

const sessionExists = async (sessionId: string, playerKey: string): Promise<string | null> => {
  const { data } = await sr
    .from('sessions')
    .select('machine_id')
    .eq('session_id', sessionId)
    .eq('player_key', playerKey)
    .maybeSingle();
  return (data as { machine_id?: string } | null)?.machine_id ?? null;
};

// === 1. Own-LAN: `ssh` onto a host running NO sshd → 404 service_not_running. ===
// The dropped exemption. A wrong password is sent deliberately: a 404 rather than a 401
// proves the door is shut before any credential is looked at.
const s1 = await post(SESSIONS, ownLan(withoutSshd, { session_id: 'gate-ssh-nodaemon' }));
const landed1 = await sessionExists('gate-ssh-nodaemon', alice.publicKeyHex);
check(
  'own-LAN ssh onto a host running no sshd is 404 service_not_running, before any password check',
  s1.status === 404 && errorOf(s1.body) === 'service_not_running' && landed1 === null,
  `status=${s1.status} error=${errorOf(s1.body)} landed=${landed1} host=${withoutSshd.ip}`,
);

// === 2. Own-LAN control: the SAME wrong password onto a host that IS serving sshd. ===
// A 401 here is what makes check 1 mean something — the gate discriminates on the
// daemon, rather than having shut the ssh door on every host.
const s2 = await post(SESSIONS, ownLan(withSshd, { session_id: 'gate-ssh-daemon' }));
check(
  'own-LAN ssh onto a host that IS serving sshd reaches the password check (401, not 404)',
  s2.status === 401 && errorOf(s2.body) === 'invalid_credentials',
  `status=${s2.status} error=${errorOf(s2.body)} host=${withSshd.ip}`,
);

// === 3. Same-LAN: A serves vsftpd on 2121 and no sshd; B knocks on 2121. ===
// The live bug: comparing the port alone opened an ssh session through an ftp port.
await sr.from('patches').insert([pidfileRow(2121, SERVICE_CATALOG.ftp)]);
const s3 = await post(
  SESSIONS,
  sameLan({ session_id: 'gate-ftp-port', username: 'guest', password: GUEST_PW, port: 2121 }),
);
const landed3 = await sessionExists('gate-ftp-port', bob.publicKeyHex);
check(
  'same-LAN ssh to a port serving vsftpd is refused, even with a CORRECT password',
  s3.status === 404 && errorOf(s3.body) === 'host_unreachable' && landed3 === null,
  `status=${s3.status} error=${errorOf(s3.body)} landed=${landed3}`,
);

// === 4. Same-LAN control: A starts sshd on 22; B gets in. ===
await sr.from('patches').delete().eq('machine_id', A_WS);
await sr.from('patches').insert([pidfileRow(22, SERVICE_CATALOG.ssh)]);
const s4 = await post(
  SESSIONS,
  sameLan({ session_id: 'gate-ssh-in', username: 'guest', password: GUEST_PW }),
);
const landed4 = await sessionExists('gate-ssh-in', bob.publicKeyHex);
check(
  'same-LAN ssh to a real sshd port lands a session on A’s workstation',
  s4.status === 200 && landed4 === A_WS,
  `status=${s4.status} landed=${landed4}`,
);

// === 5. The loop: A runs `systemctl stop sshd`, and B is shut out on the next knock. ===
// The removal goes through the REAL signed removePatch the command issues — not a
// service_role delete — so what is proved is the player's own action closing the door.
const stop = await post(
  PATCHES,
  signRequest(alice, 'removePatch', {
    machine_id: A_WS,
    path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
    owner: 'root',
  }),
);
const s5 = await post(
  SESSIONS,
  sameLan({ session_id: 'gate-ssh-stopped', username: 'guest', password: GUEST_PW }),
);
const landed5 = await sessionExists('gate-ssh-stopped', bob.publicKeyHex);
check(
  'after A stops sshd, the same login that just worked is refused',
  stop.status === 200 && s5.status === 404 && landed5 === null,
  `stop=${stop.status} status=${s5.status} error=${errorOf(s5.body)} landed=${landed5}`,
);

// === 6. And an ALREADY-OPEN session outlives the closed door. ===
// D4 decision: a stop shuts the door without emptying the room. The session B landed in
// check 4 is still there after the stop — only new logins are refused.
const survivor = await sessionExists('gate-ssh-in', bob.publicKeyHex);
check(
  'the session opened before the stop still exists — a stop refuses new logins, it does not evict',
  survivor === A_WS,
  `session=${survivor}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
