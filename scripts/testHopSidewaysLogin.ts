// Wire-payload check for the walking skeleton of operating from a hop — the claim no
// unit test can make, because it is the REAL journal and the REAL session table that
// place the caller.
//
// A player with a shell on a box reaches that box's LAN, and a login they make from it is
// logged on the target under the HOP's own address, not theirs. The server works out
// where the caller stands from the session row they hold on the hop — never from anything
// the request carries — so the three facts under test are:
//   - a sideways login from a held hop lands, and the target's auth.log names the HOP's
//     LAN address (keyed to the network, `ap:<essid>`), not the player's home lease;
//   - a request NAMING a network the caller is not standing on is refused (403), so a
//     crafted essid cannot write an attack up as some other network;
//   - a request naming a box the caller holds NO session on is refused (403).
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopSidewaysLogin.ts
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
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { accountsIn } from '../src/core/sessions/passwdAccount.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { md5 } from '../src/core/generation/md5.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
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

const ESSID = 'HOP-SIDEWAYS-WIFI';
const HOME_OCTET = 70;
const HOME_IP = lanAddressFor(ESSID, HOME_OCTET);

const alice = generateIdentity();

/** An ordinary generated sibling running ssh — `kind === 'machine'`, so not an inner
 *  gateway, which logs in through a different endpoint entirely. */
const runsSsh = (host: LanHost): boolean =>
  hostServices(ESSID, host).some(({ spec }) => spec === SERVICE_CATALOG.ssh);

const sshHosts = generateHomeLan(ESSID).hosts.filter(
  (host) => host.kind === 'machine' && runsSsh(host),
);

const hop = sshHosts[0];
const target = sshHosts[1];
if (hop === undefined || target === undefined) {
  console.error(`ESSID ${ESSID} needs two generated ssh machines — pick another.`);
  process.exit(2);
}

const hopMachine = machineIdForLanHost(hop, ESSID);
const targetMachine = machineIdForLanHost(target, ESSID);

/** The recoverable root password on a host, matched against the weak pool the way a
 *  cracker would. */
const rootPasswordOf = (host: LanHost): string | undefined => {
  const { baseFs } = resolveLanHostIdentity(host, ESSID);
  const root = accountsIn(baseFs).find((account) => account.username === 'root');
  return ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === root?.hash);
};

const hopPassword = rootPasswordOf(hop);
const targetPassword = rootPasswordOf(target);
if (hopPassword === undefined || targetPassword === undefined) {
  console.error('No recoverable root password on the chosen hosts — pick another ESSID.');
  process.exit(2);
}

/** A login from the caller's current stance. `callerMachineId` names the box the shell is
 *  standing on; omitted, the caller is at home on their own workstation. */
const login = (
  sessionId: string,
  essid: string,
  targetIp: string,
  password: string,
  callerMachineId?: string,
) =>
  post(
    signRequest(alice, 'authCreateSession', {
      session_id: sessionId,
      essid,
      target_ip: targetIp,
      username: 'root',
      password,
      parent_session_id: null,
      ...(callerMachineId === undefined ? {} : { caller_machine_id: callerMachineId }),
    }),
  );

const authLogRows = async (
  machineId: string,
): Promise<readonly { writer_key: string; content: string }[]> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH);
  mustNotFail('auth.log read', error);
  return (data ?? []) as readonly { writer_key: string; content: string }[];
};

const cleanUp = async () => {
  await leaveNetwork(sr, ESSID);
  await sr.from('patches').delete().eq('machine_id', hopMachine).eq('path', AUTH_LOG_PATH);
  await sr.from('patches').delete().eq('machine_id', targetMachine).eq('path', AUTH_LOG_PATH);
  await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
};

const main = async () => {
  console.log(`Hop ${hop.ip} (${hopMachine}), target ${target.ip} (${targetMachine}) on ${ESSID}`);

  // Seeded machine_ids are identical across runs, so a crashed earlier run would leave
  // rows this one reads as its own.
  await cleanUp();
  await standOnNetwork(sr, ESSID, alice, HOME_OCTET);

  // === 1. alice logs into the hop FROM HOME. Her lease address is what the hop sees. ===
  const ontoHop = await login('ssh-hop-1', ESSID, hop.ip, hopPassword);
  check(
    'the login onto the hop is accepted from home',
    ontoHop.status === 200,
    `status=${ontoHop.status} ${JSON.stringify(ontoHop.body)}`,
  );
  const hopLog = await authLogRows(hopMachine);
  check(
    'the hop logs that arrival from alice’s OWN home address, under the network’s key',
    hopLog.length === 1 &&
      hopLog[0]!.writer_key === apGatewayLogWriterKey(ESSID) &&
      hopLog[0]!.content.includes(`from ${HOME_IP}`),
    hopLog[0]?.content.trim().split('\n').at(-1) ?? '(no row)',
  );

  // === 2. Standing on the hop, alice walks SIDEWAYS into the target on the hop's LAN. ===
  const sideways = await login('ssh-sideways-1', ESSID, target.ip, targetPassword, hopMachine);
  check(
    'the sideways login lands',
    sideways.status === 200,
    `status=${sideways.status} ${JSON.stringify(sideways.body)}`,
  );
  const targetLog = await authLogRows(targetMachine);
  check(
    'the target’s auth.log is keyed to the network, not to alice',
    targetLog.length === 1 && targetLog[0]!.writer_key === apGatewayLogWriterKey(ESSID),
    `writer=${(targetLog[0]?.writer_key ?? '(none)').slice(0, 24)}`,
  );
  check(
    'the target saw the login arrive from the HOP’s address, never alice’s home lease',
    targetLog[0] !== undefined &&
      targetLog[0].content.includes(`from ${hop.ip}`) &&
      !targetLog[0].content.includes(HOME_IP),
    targetLog[0]?.content.trim().split('\n').at(-1) ?? '(no row)',
  );
  check(
    'no row on the target is keyed to alice herself',
    !targetLog.some((row) => row.writer_key === alice.publicKeyHex),
    targetLog.map((row) => row.writer_key.slice(0, 16)).join(',') || '(none)',
  );

  // === 3. A login NAMING a network alice is not standing on is refused. ===
  const craftedEssid = await login('ssh-crafted-1', 'SOME-OTHER-WIFI', target.ip, targetPassword);
  check(
    'a login claiming a network the caller is not on is refused',
    craftedEssid.status === 403,
    `status=${craftedEssid.status} ${JSON.stringify(craftedEssid.body)}`,
  );

  // === 4. Naming a box alice holds no session on is refused. ===
  // Any box she never logged into — neither the hop nor the target she now holds.
  const unheld = generateHomeLan(ESSID).hosts.find(
    (host) => host.ip !== hop.ip && host.ip !== target.ip,
  );
  if (unheld === undefined) {
    console.error(`ESSID ${ESSID} has no third host to stand on — pick another.`);
    process.exit(2);
  }
  const noSession = await login(
    'ssh-nosession-1',
    ESSID,
    hop.ip,
    hopPassword,
    machineIdForLanHost(unheld, ESSID),
  );
  check(
    'a login from a box the caller holds no session on is refused',
    noSession.status === 403,
    `status=${noSession.status} ${JSON.stringify(noSession.body)}`,
  );

  await cleanUp();

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
};

void main();
