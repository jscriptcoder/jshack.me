// Wire-check for CONTRACT NETWORKS (missions slice 1) — the server-only engine driven end
// to end against a running `vercel dev` + supabase, staging jobs through the REAL
// `scripts/hireme.ts` and reaching their 195 addresses through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime and the operator script):
//   - AN UNGIVEN 195 ADDRESS ANSWERS AS AN EMPTY ONE, and an accepted one answers as its
//     network: nmap finds the gateway and the forwarded port.
//   - THE GUARANTEED ROUTE LANDS ROOT ON THE KEY BOX — hydra cracks root through the forward
//     on a hydra number, msfconsole opens the pinned hole on a msfconsole number.
//   - THE KEY IS ROOT-ONLY AND MATCHES `show`: root reads it at its path, guest does not, and
//     a root's rm of it sticks.
//   - A MISSION ESSID CANNOT BE JOINED, even with the lab flag on.
//   - A SCAN FROM THE KEY BOX TRACES TO THE MISSION'S 195 ADDRESS.
//   - DROP FREES THE HANDLE; a second accept while one is active is refused.
//   - A GPG CONTRACT SEALS THE KEY: root finds the sealed file, the program holding the
//     passphrase `show` prints and the history pointing at it, and no plain key; the
//     passphrase opens the sealed file to the key; a guest is served none of the three.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissions.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import {
  missionKey,
  missionKeyPath,
  missionPassphrase,
} from '../src/core/missions/missionSecret.js';
import { decryptContent } from '../src/core/crypto/gpgCodec.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { KERN_LOG_PATH } from '../src/core/logging/kernLog.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import { plaintextFor } from '../src/test/passwords.js';
import { md5 } from '../src/core/generation/md5.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
if (!secret) {
  console.error('Missing env: MISSION_KEY_SECRET');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const results: { readonly pass: boolean }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const post = async (endpoint: string, envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  (body as { error?: string } | null)?.error ?? undefined;

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port?: number }[] } | null)?.ports ?? [])
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const foundOf = (body: unknown): boolean | undefined =>
  (body as { found?: boolean } | null)?.found;

const crackedIn = (body: unknown): readonly { username: string; password: string }[] => {
  const cracked = (body as { cracked?: unknown } | null)?.cracked;
  return Array.isArray(cracked) ? (cracked as { username: string; password: string }[]) : [];
};

/** A public address in a region block that no network bears — the empty-address reference
 *  AC 1 holds an ungiven mission address to. */
const EMPTY_PUBLIC_IP = '87.1.0.1';

/** Run `scripts/hireme.ts` as the operator would, with this process's env (dev supabase +
 *  secret). Returns the trimmed stdout, or throws with the stderr on a non-zero exit. */
// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

/** The same, but returning the exit code and stderr instead of throwing — for the refusals
 *  (no mailbox, an active contract already held). */
const hiremeExpectingRefusal = (args: readonly string[]): { code: number; stderr: string } => {
  try {
    runHireme(args);
    return { code: 0, stderr: '' };
  } catch (error) {
    const fault = error as { status?: number; stderr?: string };
    return { code: fault.status ?? 1, stderr: fault.stderr ?? '' };
  }
};

/** The first contract number at or above `from` whose route is `route` and whose key is
 *  stored as `storage` — so each is exercised on a real draw rather than a hand-picked
 *  fixture. */
const numberForRoute = (
  route: 'hydra' | 'msfconsole',
  storage: 'file' | 'gpg',
  from: number,
): number => {
  for (let candidate = from; candidate < from + 20000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    // One hop: the gateway forwards straight onto the key box this check reaches.
    if (shape.frontBox !== null) continue;
    if (shape.keyBox.route === route && shape.storage === storage) return candidate;
  }
  throw new Error(`no ${route}/${storage} number found from ${from}`);
};

const HYDRA_NUMBER = numberForRoute('hydra', 'file', 100000);
const MSF_NUMBER = numberForRoute('msfconsole', 'file', 100000);
const GPG_NUMBER = numberForRoute('hydra', 'gpg', 100000);
const MISSION_NUMBERS = [HYDRA_NUMBER, MSF_NUMBER, GPG_NUMBER];

const keyBoxIdOf = (missionNumber: number): string => {
  const essid = missionEssid(missionNumber);
  const keyBox = generateHomeLan(essid).hosts.find((host) => host.kind === 'machine');
  if (keyBox === undefined) throw new Error(`no key box for ${missionNumber}`);
  return machineIdForLanHost(keyBox, essid);
};

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined =>
  segments.reduce<FileNode | undefined>(
    (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
    tree,
  );

/** The content of the file at the absolute `path` in a cross-player FS response, or null
 *  where the walker served no such file (a tier below root is served no key). */
const contentAt = (tree: Directory | null, path: string): string | null => {
  const segments = path.split('/').filter((segment) => segment !== '');
  const node = tree === null ? undefined : nodeAt(tree, ...segments);
  return node?.kind === 'file' ? node.content : null;
};

/** Read a mission box's tree as the caller's active session tier sees it, through the real
 *  cross-player FS endpoint — which is where the server lays the key onto the key box. */
const readBoxTree = async (
  caller: ReturnType<typeof generateIdentity>,
  machineId: string,
): Promise<Directory | null> => {
  const result = await post(NETWORK, signRequest(caller, 'resolveCrossPlayerFs', { machine_id: machineId }));
  return result.status === 200
    ? deserializeTree((result.body as { tree: SerializedDirectory }).tree)
    : null;
};

/** The aggregate `/var/log/kern.log` on a box's shared record, as the scan appenders leave
 *  it — read straight from the patches table under the network's own writer key, so the
 *  test sees the same row every scanner's trace accretes into. */
const readKernLog = async (machineId: string, writerKey: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', KERN_LOG_PATH)
    .eq('writer_key', writerKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

/** Put `caller` on a session of `machineId` at `userType`, the row an ssh hop leaves — the
 *  tier the FS/write gates read. Cleared first so no stale row survives a re-run. */
const seedSession = async (
  caller: ReturnType<typeof generateIdentity>,
  machineId: string,
  essid: string,
  userType: 'root' | 'guest',
) => {
  const { error } = await sr.from('sessions').insert({
    session_id: `ssh-mission-${userType}-${RUN}-${randomInt(1_000_000)}`,
    player_key: caller.publicKeyHex,
    machine_id: machineId,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

const owner = generateIdentity();
const guestOp = generateIdentity();
const RUN = Date.now().toString(36).slice(-6);
const HANDLE = `alice${RUN}`.slice(0, 24);
const GPG_HANDLE = `bob${RUN}`.slice(0, 24);

// The operator's own box, where hydra runs and its wordlist lives. A declared crackable
// network, so the server derives a source address for the sweep's trace.
const OP_ESSID = 'BEAN-THERE-WIFI';
const OP_WS = computeWorkstationId('probe', owner.publicKeyHex);

/** The op's home occupancy, as a real join leaves it — so the server can place the op on
 *  OP_WS and derive their public source. */
const seedOpHome = async () => {
  const { error } = await sr.from('home_network_occupants').insert({
    essid: OP_ESSID,
    owner_key: owner.publicKeyHex,
    workstation_machine_id: OP_WS,
    workstation_username: 'probe',
    workstation_machine_name: 'probe',
    workstation_root_hash: md5('probe-root-secret'),
  });
  if (error) throw new Error(`op home seed failed: ${error.message}`);
};

/** The wordlist as `apt install hydra` leaves it on the op's own box. */
const seedWordlist = async (words: readonly string[]) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: OP_WS,
      path: WORDLIST_PATH,
      writer_key: owner.publicKeyHex,
      content: formatWordlist(words),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`wordlist seed failed: ${error.message}`);
};

const openMailbox = async (handle: string) => {
  const { error } = await sr.from('email_accounts').insert({
    handle,
    password_md5: md5('s3cret'),
    signed_up_by: owner.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().in('number', MISSION_NUMBERS);
  await sr.from('email_accounts').delete().eq('signed_up_by', owner.publicKeyHex);
  for (const missionNumber of MISSION_NUMBERS) {
    await sr.from('patches').delete().eq('machine_id', keyBoxIdOf(missionNumber));
    await sr.from('patches').delete().eq('machine_id', computeApGatewayId(missionEssid(missionNumber)));
  }
  await sr.from('patches').delete().eq('machine_id', OP_WS);
  await sr.from('home_network_occupants').delete().eq('owner_key', owner.publicKeyHex);
  for (const identity of [owner, guestOp]) {
    await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
  }
};

const main = async () => {
  console.log(`hydra number ${HYDRA_NUMBER} @ ${missionAddressForNumber(HYDRA_NUMBER)}, ` +
    `msfconsole number ${MSF_NUMBER} @ ${missionAddressForNumber(MSF_NUMBER)}, ` +
    `gpg number ${GPG_NUMBER} @ ${missionAddressForNumber(GPG_NUMBER)}\n`);

  await cleanup();
  await openMailbox(HANDLE);
  await openMailbox(GPG_HANDLE);
  await seedOpHome();

  // === 1. AN UNGIVEN 195 ADDRESS ANSWERS AS AN EMPTY ONE. ===
  const beforeAddress = missionAddressForNumber(HYDRA_NUMBER)!;
  const scanBefore = await post(NETWORK, signRequest(owner, 'resolvePublicScan', { target: beforeAddress }));
  const scanEmpty = await post(NETWORK, signRequest(owner, 'resolvePublicScan', { target: EMPTY_PUBLIC_IP }));
  check(
    'an ungiven 195 address answers nmap exactly as an empty address does (found:false, no ports)',
    scanBefore.status === scanEmpty.status &&
      foundOf(scanBefore.body) === false &&
      foundOf(scanEmpty.body) === false &&
      portsOf(scanBefore.body).length === 0,
    `195 ungiven: status ${scanBefore.status} found ${String(foundOf(scanBefore.body))}; ` +
      `empty: status ${scanEmpty.status} found ${String(foundOf(scanEmpty.body))}`,
  );

  // === 2. A MISSION ESSID CANNOT BE JOINED, lab flag or no lab flag. ===
  const join = await post(NETWORK, signRequest(owner, 'registerNetwork', {
    essid: missionEssid(HYDRA_NUMBER),
    workstation_machine_id: computeWorkstationId('probe', owner.publicKeyHex),
    workstation_username: 'probe',
    workstation_machine_name: 'probe',
    workstation_root_hash: md5('probe-root-secret'),
  }));
  check(
    'a join of a mission ESSID is refused network_not_joinable',
    join.status === 403 && errorOf(join.body) === 'network_not_joinable',
    `status ${join.status} ${errorOf(join.body) ?? ''}`,
  );

  // === 3. ACCEPTING MAKES THE ADDRESS REACHABLE; nmap finds the forwarded port. ===
  const accepted = runHireme(['accept', HANDLE, '--number', String(HYDRA_NUMBER)]);
  const address = missionAddressForNumber(HYDRA_NUMBER)!;
  check(
    'scripts/hireme.ts accept prints the address for the accepted number',
    accepted.includes(address) && accepted.includes(String(HYDRA_NUMBER)),
    accepted,
  );
  const [forward] = missionShape(HYDRA_NUMBER).forwards;
  if (forward === undefined) throw new Error('a hydra contract has a forward');
  const scanAfter = await post(NETWORK, signRequest(owner, 'resolvePublicScan', { target: address }));
  const ports = portsOf(scanAfter.body);
  check(
    'after accept, nmap <address> lists the gateway forwarded port',
    scanAfter.status === 200 && ports.includes(forward.publicPort),
    `status ${scanAfter.status} ports=[${ports.join(',')}] (want :${forward.publicPort})`,
  );

  // === 4. DROP FREES THE HANDLE; a second accept while active is refused. ===
  const secondWhileActive = hiremeExpectingRefusal(['accept', HANDLE, '--number', String(MSF_NUMBER)]);
  check(
    'a second accept while one is active is refused',
    secondWhileActive.code === 1 && secondWhileActive.stderr.includes('active contract'),
    `code ${secondWhileActive.code} ${secondWhileActive.stderr.trim()}`,
  );
  const dropped = runHireme(['drop', HANDLE]);
  check(
    'scripts/hireme.ts drop reports the address stays reachable',
    dropped.includes(address),
    dropped,
  );
  const scanDropped = await post(NETWORK, signRequest(owner, 'resolvePublicScan', { target: address }));
  check(
    'a dropped contract stays reachable',
    scanDropped.status === 200 && portsOf(scanDropped.body).includes(forward.publicPort),
    `status ${scanDropped.status}`,
  );
  const reaccept = runHireme(['accept', HANDLE, '--number', String(MSF_NUMBER)]);
  check(
    'after dropping, the handle may accept again',
    reaccept.includes(missionAddressForNumber(MSF_NUMBER)!),
    reaccept,
  );
  // After the lifecycle: HYDRA_NUMBER is abandoned (still reachable, decision 5) and
  // MSF_NUMBER is accepted — both answer as their networks for the route and key checks.

  // === 5. THE HYDRA ROUTE CRACKS ROOT ON THE KEY BOX, AND SSH LANDS THERE. ===
  const hydraAddress = missionAddressForNumber(HYDRA_NUMBER)!;
  const [hydraForward] = missionShape(HYDRA_NUMBER).forwards;
  if (hydraForward === undefined) throw new Error('a hydra contract has a forward');
  const hydraRootPassword = plaintextFor(missionShape(HYDRA_NUMBER).keyBox.rootHash);
  await seedWordlist([hydraRootPassword]);
  const cracked = await post(SESSIONS, signRequest(owner, 'hydraCrack', {
    essid: OP_ESSID,
    target_ip: hydraAddress,
    service: 'ssh',
    caller_machine_id: OP_WS,
    port: hydraForward.publicPort,
  }));
  const crackedRoot = crackedIn(cracked.body).find((entry) => entry.username === 'root');
  check(
    'hydra through the forward cracks the key box root',
    cracked.status === 200 && crackedRoot?.password === hydraRootPassword,
    `status ${cracked.status} cracked ${JSON.stringify(crackedIn(cracked.body))}`,
  );
  const hydraKeyBox = keyBoxIdOf(HYDRA_NUMBER);
  const rooted = await post(SESSIONS, signRequest(owner, 'authCreateSessionPublic', {
    session_id: `ssh-root-hydra-${RUN}`,
    target: hydraAddress,
    port: hydraForward.publicPort,
    username: 'root',
    password: crackedRoot?.password ?? 'no-password',
    parent_session_id: null,
    source_ip: null,
  }));
  check(
    'ssh root@<address> -p <forward> lands a root shell on the key box',
    rooted.status === 200 && (rooted.body as { machine_id?: string } | null)?.machine_id === hydraKeyBox,
    `status ${rooted.status} machine ${(rooted.body as { machine_id?: string } | null)?.machine_id ?? '-'}`,
  );

  // === 6. THE KEY IS ROOT-ONLY AND MATCHES `show`; A ROOT'S rm OF IT STICKS. ===
  const hydraKeyPath = missionKeyPath(HYDRA_NUMBER);
  const expectedKey = missionKey(HYDRA_NUMBER, secret);
  const shownKey = (runHireme(['show', hydraAddress]).match(/ACCESS-[0-9A-HJKMNP-TV-Z-]+/) ?? [''])[0];
  const asRoot = await readBoxTree(owner, hydraKeyBox);
  check(
    'root reads the key at its path, and it is the key `show` prints',
    contentAt(asRoot, hydraKeyPath)?.trim() === expectedKey && shownKey === expectedKey,
    `box ${String(contentAt(asRoot, hydraKeyPath)).trim()} / show ${shownKey} / expected ${expectedKey}`,
  );
  await seedSession(guestOp, hydraKeyBox, missionEssid(HYDRA_NUMBER), 'guest');
  const asGuest = await readBoxTree(guestOp, hydraKeyBox);
  check(
    'a guest shell on the key box is served no key',
    contentAt(asGuest, hydraKeyPath) === null,
    `guest saw ${String(contentAt(asGuest, hydraKeyPath))}`,
  );
  const removed = await post(PATCHES, signRequest(owner, 'removePatch', {
    machine_id: hydraKeyBox,
    path: hydraKeyPath,
    owner: 'root',
  }));
  const afterRm = await readBoxTree(owner, hydraKeyBox);
  check(
    "a root's rm of the key sticks for the next root reader",
    removed.status === 200 && contentAt(afterRm, hydraKeyPath) === null,
    `rm status ${removed.status}, key after ${String(contentAt(afterRm, hydraKeyPath))}`,
  );

  // === 7. THE MSFCONSOLE ROUTE OPENS THE PINNED HOLE AND LANDS ROOT ON THE KEY BOX. ===
  const msfAddress = missionAddressForNumber(MSF_NUMBER)!;
  const [msfForward] = missionShape(MSF_NUMBER).forwards;
  if (msfForward === undefined) throw new Error('an msfconsole contract has a forward');
  const msfKeyBox = keyBoxIdOf(MSF_NUMBER);
  const exploited = await post(SESSIONS, signRequest(owner, 'exploitCreateSession', {
    session_id: `msf-root-${RUN}`,
    essid: OP_ESSID,
    target_ip: msfAddress,
    port: msfForward.publicPort,
    caller_machine_id: OP_WS,
    parent_session_id: null,
  }));
  const msfBody = exploited.body as { machine_id?: string; userType?: string } | null;
  check(
    'msfconsole opens the pinned hole and lands root on the key box',
    exploited.status === 200 && msfBody?.machine_id === msfKeyBox && msfBody.userType === 'root',
    `status ${exploited.status} body ${JSON.stringify(exploited.body)}`,
  );
  const scanMsf = await post(NETWORK, signRequest(owner, 'resolvePublicScan', { target: msfAddress }));
  check(
    'nmap of a msfconsole address lists the forwarded port the CVE fires through',
    scanMsf.status === 200 && portsOf(scanMsf.body).includes(msfForward.publicPort),
    `status ${scanMsf.status} ports=[${portsOf(scanMsf.body).join(',')}] (want :${msfForward.publicPort})`,
  );

  // === 8. FROM A SHELL ON THE KEY BOX, THE MISSION LAN RESOLVES (decision 13's hop check). ===
  // The HYDRA key box still carries the owner's root session from section 5, standing on the
  // mission essid — the shell a contractor would sweep its own subnet from.
  const hydraEssid = missionEssid(HYDRA_NUMBER);
  const hydraLan = generateHomeLan(hydraEssid);
  const gatewayLanIp = `${hydraLan.subnet}.1`;
  const sweep = await post(PATCHES, signRequest(owner, 'nmapScan', {
    essid: hydraEssid,
    target: `${hydraLan.subnet}.1-254`,
    caller_machine_id: hydraKeyBox,
  }));
  const swept = (sweep.body as { hostsLogged?: number } | null)?.hostsLogged;
  check(
    'nmap of the mission subnet from the key box resolves server-side and sweeps both boxes',
    sweep.status === 200 && swept === hydraLan.hosts.length,
    `status ${sweep.status} hostsLogged ${String(swept)} (want ${hydraLan.hosts.length})`,
  );
  // The host list the client renders is generated from the essid (bundle), and it names the
  // gateway and the key box — the two the server just swept.
  const lanIps = hydraLan.hosts.map((host) => host.ip);
  check(
    'the LAN generated from the mission essid holds the gateway and the key box',
    lanIps.includes(gatewayLanIp) && hydraLan.hosts.some((host) => host.kind === 'machine'),
    `hosts [${lanIps.join(',')}]`,
  );
  // ssh sideways to the gateway is ANSWERED — a wrong password is refused by the gateway's
  // own sshd (invalid_credentials), not a route that was never there (host_unreachable).
  const sideways = await post(SESSIONS, signRequest(owner, 'authCreateSession', {
    session_id: `ssh-sideways-${RUN}`,
    essid: hydraEssid,
    target_ip: gatewayLanIp,
    caller_machine_id: hydraKeyBox,
    username: 'admin',
    password: `wrong-${RUN}`,
    parent_session_id: null,
  }));
  check(
    'ssh sideways to the mission gateway is answered (invalid_credentials), never No route to host',
    sideways.status === 401 && errorOf(sideways.body) === 'invalid_credentials',
    `status ${sideways.status} ${errorOf(sideways.body) ?? ''}`,
  );

  // === 9. A SCAN TYPED ON THE KEY BOX TRACES TO THE MISSION'S 195 ADDRESS. ===
  // Standing on the HYDRA key box (essid mission-HYDRA), the owner scans the MSF 195 address;
  // the server derives the source from where they stand — HYDRA's 195 address — and writes it
  // on the MSF gateway's shared kern.log, never the scanner's home or a client claim.
  const scanFromKeyBox = await post(NETWORK, signRequest(owner, 'resolvePublicScan', {
    target: msfAddress,
    caller_machine_id: hydraKeyBox,
  }));
  const msfGatewayKern = await readKernLog(
    computeApGatewayId(missionEssid(MSF_NUMBER)),
    apGatewayLogWriterKey(missionEssid(MSF_NUMBER)),
  );
  check(
    "a scan from the key box records the mission's own 195 address on the scanned box, not home or unknown",
    scanFromKeyBox.status === 200 &&
      msfGatewayKern.includes(hydraAddress) &&
      !msfGatewayKern.includes('unknown'),
    `status ${scanFromKeyBox.status} traced 195=${msfGatewayKern.includes(hydraAddress)} ` +
      `last="${msfGatewayKern.trim().split('\n').at(-1) ?? ''}"`,
  );

  // === 10. A GPG CONTRACT SEALS THE KEY, AND THE PROGRAM BESIDE IT HOLDS THE PASSPHRASE. ===
  runHireme(['accept', GPG_HANDLE, '--number', String(GPG_NUMBER)]);
  const gpgAddress = missionAddressForNumber(GPG_NUMBER)!;
  const gpgShape = missionShape(GPG_NUMBER);
  const [gpgForward] = gpgShape.forwards;
  if (gpgForward === undefined) throw new Error('a hydra contract has a forward');
  const gpgRootPassword = plaintextFor(gpgShape.keyBox.rootHash);
  await seedWordlist([gpgRootPassword]);
  const gpgCracked = await post(SESSIONS, signRequest(owner, 'hydraCrack', {
    essid: OP_ESSID,
    target_ip: gpgAddress,
    service: 'ssh',
    caller_machine_id: OP_WS,
    port: gpgForward.publicPort,
  }));
  const gpgKeyBox = keyBoxIdOf(GPG_NUMBER);
  const gpgRooted = await post(SESSIONS, signRequest(owner, 'authCreateSessionPublic', {
    session_id: `ssh-root-gpg-${RUN}`,
    target: gpgAddress,
    port: gpgForward.publicPort,
    username: 'root',
    password: crackedIn(gpgCracked.body).find((entry) => entry.username === 'root')?.password ?? '-',
    parent_session_id: null,
    source_ip: null,
  }));
  check(
    'hydra and ssh land a root shell on a gpg contract key box',
    gpgRooted.status === 200 &&
      (gpgRooted.body as { machine_id?: string } | null)?.machine_id === gpgKeyBox,
    `crack ${gpgCracked.status} ssh ${gpgRooted.status}`,
  );

  const plainPath = missionKeyPath(GPG_NUMBER);
  const sealedPath = `${plainPath}.gpg`;
  const programPath = `/usr/local/bin/${gpgShape.stem}-vault`;
  const gpgKey = missionKey(GPG_NUMBER, secret);
  const shownGpg = runHireme(['show', gpgAddress]);
  const shownPassphrase = (shownGpg.match(/passphrase (hv-[0-9A-HJKMNP-TV-Z-]+)/) ?? ['', ''])[1];
  const gpgAsRoot = await readBoxTree(owner, gpgKeyBox);
  const sealed = contentAt(gpgAsRoot, sealedPath);
  check(
    '`show` prints the passphrase, and it opens the sealed key root finds to the key',
    shownPassphrase === missionPassphrase(GPG_NUMBER, secret) &&
      sealed !== null &&
      decryptContent(sealed, shownPassphrase ?? '')?.trim() === gpgKey,
    `show passphrase ${shownPassphrase ?? '-'}, sealed ${sealed === null ? 'missing' : 'present'}`,
  );
  check(
    'root finds no plain key on a gpg contract',
    contentAt(gpgAsRoot, plainPath) === null,
    `plain key ${String(contentAt(gpgAsRoot, plainPath))}`,
  );
  check(
    'root finds the program holding the passphrase, and a history pointing at it',
    (contentAt(gpgAsRoot, programPath) ?? '').includes(shownPassphrase ?? '-') &&
      (contentAt(gpgAsRoot, '/root/.bash_history') ?? '').includes(
        `${gpgShape.stem}-vault --seal ${plainPath}`,
      ),
    `program ${contentAt(gpgAsRoot, programPath) === null ? 'missing' : 'present'}, ` +
      `history ${JSON.stringify(contentAt(gpgAsRoot, '/root/.bash_history'))}`,
  );
  await seedSession(guestOp, gpgKeyBox, missionEssid(GPG_NUMBER), 'guest');
  const gpgAsGuest = await readBoxTree(guestOp, gpgKeyBox);
  check(
    'a guest is served neither the sealed key nor the history, and may read the program',
    contentAt(gpgAsGuest, sealedPath) === null &&
      contentAt(gpgAsGuest, '/root/.bash_history') === null &&
      contentAt(gpgAsGuest, programPath) !== null,
    `guest sealed ${contentAt(gpgAsGuest, sealedPath) !== null}, ` +
      `history ${contentAt(gpgAsGuest, '/root/.bash_history') !== null}, ` +
      `program ${contentAt(gpgAsGuest, programPath) !== null}`,
  );
  const sealedRemoved = await post(PATCHES, signRequest(owner, 'removePatch', {
    machine_id: gpgKeyBox,
    path: sealedPath,
    owner: 'root',
  }));
  const afterSealedRm = await readBoxTree(owner, gpgKeyBox);
  check(
    "a root's rm of the sealed key sticks for the next root reader",
    sealedRemoved.status === 200 && contentAt(afterSealedRm, sealedPath) === null,
    `rm status ${sealedRemoved.status}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (error: unknown) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
