// Wire-check — `hydra` runs from a hop. The one `hydraCrack` action now reaches every
// target through the shared `reachServiceHost`, so proving that reach lives from a hop
// proves the sweep for the own LAN, a deep layer, loopback and a public address alike.
// The op sits at home and holds a shell on a box; every sweep names that box
// (`caller_machine_id`), the server works out from the op's own session row where the op
// stands — never from anything the request claims — and the wordlist is read from the
// box the op is standing on. So:
//   - a LAN sweep from the hop lands on a box on the hop's LAN, traced from the HOP's own
//     LAN address rather than a client-sent source;
//   - `localhost` on the hop sweeps the hop box's own sshd, traced over `127.0.0.1`;
//   - a sweep naming a network the hop is not on is 403 `wrong_network`, and one naming a
//     box the op holds no shell on is 403 `no_session`; both write nothing;
//   - a sweep of a box on a DEEP layer the hop reaches cracks it by its address there, and
//     a switch fronting that layer applies its live ACL — a denied port is refused exactly
//     like an unserved one, and clearing the deny re-opens it;
//   - a PUBLIC target swept from the hop is traced under the HOP network's public address,
//     and the same target from home under the op's own — the origin the hop masks.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHopHydra.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity.js';
import { chainLinks, machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { generateDeepLayer } from '../src/core/generation/generateDeepLayer.js';
import { buildDeepHostFs } from '../src/core/generation/deepHostFs.js';
import { hostMachineId } from '../src/core/generation/remoteHostId.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { seedApGatewayAdminPw } from '../src/core/generation/routerFs.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { publicAddress } from '../src/core/generation/world.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { AUTH_LOG_PATH } from '../src/core/logging/authLog.js';
import { accountsIn, accountIn } from '../src/core/sessions/passwdAccount.js';
import { ALL_GENERATED_PASSWORDS } from '../src/core/generation/passwordPools.js';
import { md5 } from '../src/core/generation/md5.js';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist.js';
import { SERVICE_CATALOG } from '../src/core/services/serviceCatalog.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { standOnNetwork, leaveNetwork } from './standVantage.js';

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
  envelope: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> => {
  const response = await fetch(SESSIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
};

const op = generateIdentity();
const WORKSTATION = 'rig';
const HOME_WS_ID = computeWorkstationId(WORKSTATION, op.publicKeyHex);

/** The first account on a generated host whose stored hash is a password from the crackable
 *  pool — the one a wordlist seeded with that word will recover. `null` when every account
 *  on the box is drawn from the uncrackable stream. */
const crackableAccountOn = (
  essid: string,
  host: LanHost,
): { readonly username: string; readonly password: string } | null => {
  const { baseFs } = resolveLanHostIdentity(host, essid);
  for (const account of accountsIn(baseFs)) {
    const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
    if (password !== undefined) return { username: account.username, password };
  }
  return null;
};

const sshMachinesOn = (essid: string): readonly LanHost[] =>
  generateHomeLan(essid).hosts.filter(
    (host) =>
      host.kind === 'machine' &&
      hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.ssh),
  );

// ─── Network N: a crackable network with a public face and two ssh machines that each
//     carry a crackable account — one the op stands on (the hop), one it sweeps. ───
const findN = () => {
  for (const essid of crackableEssidPool) {
    if (publicAddress(essid) === undefined) continue;
    const machines = sshMachinesOn(essid);
    const crackable = machines
      .map((host) => ({ host, account: crackableAccountOn(essid, host) }))
      .filter((entry): entry is { host: LanHost; account: { username: string; password: string } } =>
        entry.account !== null,
      );
    if (crackable.length >= 2) {
      return { essid, hop: crackable[0]!, target: crackable[1]! };
    }
  }
  return null;
};

// ─── Network D: an inner SWITCH fronting a deep layer whose deep host runs ssh with a
//     crackable guest — the deep-by-address and switch-ACL cases. ───
const findDeep = () => {
  for (const essid of crackableEssidPool) {
    const innerSwitch = chainLinks(essid).find(
      (link) => link.parentMachineId === null && link.host.kind === 'switch',
    );
    if (innerSwitch === undefined) continue;
    const layer = generateDeepLayer(
      essid,
      { machineId: innerSwitch.machineId, kind: 'switch' },
      { hangsChild: innerSwitch.hangsChild },
    );
    const guest = accountIn(buildDeepHostFs(essid, layer.host), 'guest');
    const password =
      guest === null
        ? undefined
        : ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === guest.hash);
    if (password === undefined) continue;
    return {
      essid,
      switchId: innerSwitch.machineId,
      deepHost: layer.host,
      deepId: hostMachineId(layer.host, essid),
      layerSubnet: layer.subnet,
      guestPassword: password,
    };
  }
  return null;
};

const n = findN();
if (n === null) {
  console.error('no crackable network with a public face carries two ssh boxes with crackable accounts');
  process.exit(2);
}
const deep = findDeep();
if (deep === null) {
  console.error('no crackable network fronts a deep ssh layer with a crackable guest behind a switch');
  process.exit(2);
}

// Home (H) and the public target (P): two more declared crackable networks, distinct from N
// and D, so the public addresses this check contrasts are all different. P's gateway sshd is
// the public target, crackable via its seeded admin password.
const spare = crackableEssidPool.filter(
  (essid) =>
    essid !== n.essid && essid !== deep.essid && publicAddress(essid) !== undefined,
);
const HOME = spare[0];
const TARGET = spare[1];
if (HOME === undefined || TARGET === undefined) {
  console.error('not enough declared crackable networks to stand a home and a public target apart');
  process.exit(2);
}

const N = n.essid;
const N_PUBLIC = publicAddress(N)!;
const HOME_PUBLIC = publicAddress(HOME)!;
const HOP_ID = machineIdForLanHost(n.hop.host, N);
const HOP_IP = n.hop.host.ip;
// The hop box's own sshd may listen anywhere — a generated machine runs ssh on a seeded
// port, not always 22. `localhost` is now port-first like every other reach, so the
// loopback sweep names the port the hop's own daemon actually holds.
const HOP_SSH_PORT = hostServices(N, n.hop.host).find(
  (service) => service.spec === SERVICE_CATALOG.ssh,
)!.port;
const TARGET_HOST_ID = resolveLanHostIdentity(n.target.host, N).machineId;
const N_GATEWAY_ID = computeApGatewayId(N);

const TARGET_PUBLIC = publicAddress(TARGET)!;
const TARGET_GATEWAY_ID = computeApGatewayId(TARGET);
const TARGET_ADMIN_PW = seedApGatewayAdminPw(TARGET);

const SWEEP_PORT = SERVICE_CATALOG.ssh.defaultPort;
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const ACL_PATH = '/etc/switch/acl.conf';

const TOUCHED = [HOP_ID, TARGET_HOST_ID, deep.deepId, deep.switchId, TARGET_GATEWAY_ID];

const hydra = (over: Record<string, unknown>) =>
  post(signRequest(op, 'hydraCrack', { essid: N, service: 'ssh', ...over }));

const authLogOn = async (machineId: string, essid: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(essid))
    .maybeSingle();
  return (data as { content?: string | null } | null)?.content ?? '';
};

const clearLog = (machineId: string, essid: string) =>
  sr
    .from('patches')
    .delete()
    .eq('machine_id', machineId)
    .eq('path', AUTH_LOG_PATH)
    .eq('writer_key', apGatewayLogWriterKey(essid));

const plant = async (machineId: string, path: string, content: string) => {
  const { error } = await sr.from('patches').upsert(
    {
      writer_key: op.publicKeyHex,
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: ROOT_ONLY,
      node_type: 'file',
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error !== null) {
    console.error(`FATAL: could not plant ${path} on ${machineId}: ${error.message}`);
    process.exit(1);
  }
};

const seedWordlist = (machineId: string, words: readonly string[]) =>
  plant(machineId, WORDLIST_PATH, formatWordlist(words));

const seedSession = (sessionId: string, machineId: string, essid: string) =>
  sr.from('sessions').insert({
    session_id: sessionId,
    player_key: op.publicKeyHex,
    machine_id: machineId,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid,
  });

const errorOf = (body: Record<string, unknown> | null): string => String(body?.error ?? '');

const cleanUp = async () => {
  for (const machineId of TOUCHED) await sr.from('patches').delete().eq('machine_id', machineId);
  await sr.from('patches').delete().eq('machine_id', HOME_WS_ID);
  await sr.from('sessions').delete().eq('player_key', op.publicKeyHex);
  await leaveNetwork(sr, HOME);
};

// ─── The world, as a real session would leave it ───
await cleanUp();
// The op occupies HOME (for the from-home public sweep) and holds shells on the hop box on
// N and the inner switch on D. The wordlist on each vantage box carries exactly the
// passwords that box's sweeps need to recover.
await standOnNetwork(sr, HOME, op, 27, WORKSTATION);
await seedSession('hop-n', HOP_ID, N);
await seedSession('hop-d-switch', deep.switchId, deep.essid);
await seedWordlist(HOP_ID, [n.hop.account.password, n.target.account.password, TARGET_ADMIN_PW]);
await seedWordlist(deep.switchId, [deep.guestPassword]);
await seedWordlist(HOME_WS_ID, [TARGET_ADMIN_PW]);

console.log(
  `N ${N} @ ${N_PUBLIC} — hop ${n.hop.host.hostname} ${HOP_IP}, target ${n.target.host.hostname} ${n.target.host.ip}\n` +
    `D ${deep.essid} — deep box ${deep.deepHost.hostname} ${deep.deepHost.ip} behind a switch at ${deep.layerSubnet}.1\n` +
    `home ${HOME} @ ${HOME_PUBLIC}; public target ${TARGET} @ ${TARGET_PUBLIC}\n`,
);

try {
  // === 1. A LAN sweep from the hop cracks the target, traced from the HOP's own address. ===
  await clearLog(TARGET_HOST_ID, N);
  const lanSweep = await hydra({ target_ip: n.target.host.ip, caller_machine_id: HOP_ID });
  const lanLog = await authLogOn(TARGET_HOST_ID, N);
  check(
    "a LAN sweep from the hop cracks the target, traced from the hop's own LAN address",
    lanSweep.status === 200 &&
      (lanSweep.body?.cracked as unknown[] | undefined)?.length !== 0 &&
      lanLog.includes(`from ${HOP_IP}`),
    `status=${lanSweep.status} cracked=${JSON.stringify(lanSweep.body?.cracked)} log=${JSON.stringify(lanLog.trim().split('\n').slice(-2))}`,
  );

  // === 2. `localhost` on the hop sweeps the hop box's OWN sshd, traced over loopback. ===
  await clearLog(HOP_ID, N);
  const loop = await hydra({ target_ip: '127.0.0.1', port: HOP_SSH_PORT, caller_machine_id: HOP_ID });
  const loopLog = await authLogOn(HOP_ID, N);
  check(
    "localhost on the hop sweeps the hop box's own sshd, traced over loopback",
    loop.status === 200 && loopLog.includes('from 127.0.0.1'),
    `status=${loop.status} log=${JSON.stringify(loopLog.trim().split('\n').slice(-2))}`,
  );

  // === 3. A network the hop is not on → wrong_network; a box with no shell → no_session. ===
  const wrongNet = await hydra({
    target_ip: n.target.host.ip,
    essid: HOME,
    caller_machine_id: HOP_ID,
  });
  check(
    'a sweep naming a network the hop is not on is refused wrong_network',
    wrongNet.status === 403 && errorOf(wrongNet.body) === 'wrong_network',
    `status=${wrongNet.status} body=${JSON.stringify(wrongNet.body)}`,
  );
  const noShell = await hydra({ target_ip: n.target.host.ip, caller_machine_id: N_GATEWAY_ID });
  check(
    'a sweep naming a box the op holds no shell on is refused no_session',
    noShell.status === 403 && errorOf(noShell.body) === 'no_session',
    `status=${noShell.status} body=${JSON.stringify(noShell.body)}`,
  );

  // === 4. A box on a DEEP layer the hop reaches, cracked by its address there. ===
  await clearLog(deep.deepId, deep.essid);
  const deepSweep = await hydra({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    username: 'guest',
    caller_machine_id: deep.switchId,
  });
  const deepLog = await authLogOn(deep.deepId, deep.essid);
  check(
    "a deep-layer sweep cracks the box by its address, traced from the layer's .1",
    deepSweep.status === 200 &&
      (deepSweep.body?.cracked as unknown[] | undefined)?.length !== 0 &&
      deepLog.includes(`from ${deep.layerSubnet}.1`),
    `status=${deepSweep.status} cracked=${JSON.stringify(deepSweep.body?.cracked)} log=${JSON.stringify(deepLog.trim().split('\n').slice(-2))}`,
  );

  // === 5. A switch-denied port is refused like an unserved one, and clearing it re-opens. ===
  await plant(deep.switchId, ACL_PATH, `# acl\ndeny ${SWEEP_PORT}\n`);
  const denied = await hydra({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    username: 'guest',
    caller_machine_id: deep.switchId,
  });
  await sr.from('patches').delete().eq('machine_id', deep.switchId).eq('path', ACL_PATH);
  const reopened = await hydra({
    essid: deep.essid,
    target_ip: deep.deepHost.ip,
    username: 'guest',
    caller_machine_id: deep.switchId,
  });
  check(
    'a switch ACL that denies the port makes the deep box dark, and removing it re-opens it',
    denied.status === 404 &&
      errorOf(denied.body) === 'service_not_running' &&
      reopened.status === 200,
    `denied=${denied.status}/${errorOf(denied.body)} reopened=${reopened.status}`,
  );

  // === 6. A PUBLIC target swept from the hop is traced under the HOP network's public
  //     address, and from home under the op's own. ===
  await clearLog(TARGET_GATEWAY_ID, TARGET);
  const fromHop = await hydra({
    essid: N,
    target_ip: TARGET_PUBLIC,
    caller_machine_id: HOP_ID,
  });
  const fromHome = await hydra({ essid: HOME, target_ip: TARGET_PUBLIC, caller_machine_id: HOME_WS_ID });
  const targetLog = await authLogOn(TARGET_GATEWAY_ID, TARGET);
  check(
    "a public sweep from the hop shows the hop network's address, from home the op's own",
    fromHop.status === 200 &&
      fromHome.status === 200 &&
      N_PUBLIC !== HOME_PUBLIC &&
      targetLog.includes(`from ${N_PUBLIC}`) &&
      targetLog.includes(`from ${HOME_PUBLIC}`),
    `hop=${fromHop.status} home=${fromHome.status} ${N_PUBLIC} vs ${HOME_PUBLIC} | ` +
      JSON.stringify(targetLog.trim().split('\n').slice(-4)),
  );
} finally {
  await cleanUp();
}

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
