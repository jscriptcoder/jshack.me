// Wire-payload smoke for SCRIPT HOLES reading the box as it stands — the two-step
// `exploitCreateSession` / `exploitLocalElevate` script_exec flow. Drives the REAL
// /api/sessions and /api/network endpoints against a running `vercel dev` + supabase.
//
// A script an `msfconsole` hole runs cannot run on the server — building a function over
// player-supplied source there would run it inside the server — so it runs on the CLIENT,
// in two steps. Step 1 is an ordinary fire carrying `script_ready: true`: the server hands
// back the target AS IT STANDS, filtered to the tier the hole granted, and the client runs
// the script against it. Step 2 is the same fire again carrying the `writes` the script
// then made, each re-walked at the granted tier before it lands.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SERVED TREE IS THE BOX AS IT STANDS, not a client regeneration of it. A file a
//     player rewrote and a file a player planted — both journal rows — come back in step 1's
//     tree. The old code rebuilt the target client-side with no journal, so these were
//     invisible to the script; this is the RED the whole slice turns.
//   - A READ-MODIFY-WRITE KEEPS THE PLAYER'S VERSION. The script appends to what step 1
//     served and sends it back; step 2 lands the served bytes plus the edit, and the file's
//     own owner is left alone — so a script no longer silently restores a file to its
//     generated state the way it used to.
//   - THE TREE IS FILTERED TO THE GRANTED TIER. A `user` hole on a fellow occupant's box
//     returns their user-readable wallet file and NOT their root-only `/root` — the same
//     server-served, tier-pruned tree a cross-player read returns.
//   - `--local` ON A BOX THAT IS NOT THE CALLER'S OWN serves at the GRANTED tier, not the
//     caller's: a root hole fired from a GUEST session gets a tree carrying `/root`, which
//     the guest could never read itself.
//   - TWO LINES, OR NONE. A network script run leaves exactly two exploit lines (one per
//     step); a fire that names no script leaves none and asks for one. `--local` leaves none
//     either way — it acts on the box the caller already stands on.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testScriptHolesReadTheBox.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { hostServices } from '../src/core/generation/remoteHostFs.js';
import { resolveLanHostIdentity, networkBaseFsForMachineId } from '../src/core/generation/lanHostIdentity.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { buildOccupantWorkstationFs } from '../src/core/patches/remoteWritePermission.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import { md5 } from '../src/core/generation/md5.js';
import { binaryStub } from '../src/core/generation/binaries.js';
import { exploitLogOf, SERVICE_CATALOG, type ServiceSpec } from '../src/core/services/serviceCatalog.js';
import { formatPidfileContent, pidfilePath } from '../src/core/services/pidfile.js';
import { exploitOutcome } from '../src/core/cve/exploitEffect.js';
import { localExploitOutcome } from '../src/core/cve/localExploit.js';
import { packageTimeline } from '../src/core/cve/packageTimeline.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  buildEntry,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageEntries,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode, FilePermissions } from '../src/core/filesystem/types.js';
import { asEpochMs } from '../src/core/types.js';

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

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;

/** Walk a deserialized tree to a node, undefined if any segment is missing. */
const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const fileContent = (tree: Directory, ...segments: readonly string[]): string | undefined => {
  const node = nodeAt(tree, ...segments);
  return node?.kind === 'file' ? node.content : undefined;
};

/** The served tree a step-1 answer carries, decoded the way the real client decodes it. */
const servedTree = (body: unknown): Directory | undefined => {
  const raw = field(body, 'tree');
  return raw === undefined ? undefined : deserializeTree(raw as SerializedDirectory);
};

const linesIn = (content: string | null): readonly string[] =>
  (content ?? '').split('\n').filter((line) => line.length > 0);

type PatchRow = { readonly content: string | null; readonly owner: string | null };

const readPatch = async (
  machineId: string,
  path: string,
  writerKey: string,
): Promise<PatchRow | null> => {
  const { data, error } = await sr
    .from('patches')
    .select('content, owner')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', writerKey)
    .maybeSingle();
  if (error) throw new Error(`patch read failed (${path}): ${error.message}`);
  return data === null ? null : { content: data.content, owner: data.owner };
};

const seedPatch = async (row: {
  readonly machineId: string;
  readonly path: string;
  readonly content: string | null;
  readonly owner: string;
  readonly permissions: unknown;
  readonly writerKey: string;
}) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: row.machineId,
      path: row.path,
      content: row.content,
      owner: row.owner,
      permissions: row.permissions,
      node_type: 'file',
      writer_key: row.writerKey,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`patch seed failed (${row.path}): ${error.message}`);
};

const today = gameDayAt(asEpochMs(Date.now()));

/** The script door on a generated box: the first LAN machine advertising a service whose
 *  shipped release rolls a script_exec hole. nginx rolls one at the version every box ships,
 *  so an ordinary ESSID produces one with no walking at all. */
const NET_ESSID = 'EXPLOIT-LAB-WIFI';
type ScriptDoor = {
  readonly ip: string;
  readonly port: number;
  readonly spec: ServiceSpec;
  readonly machineId: string;
  readonly tier: 'guest' | 'user' | 'root';
  readonly cve: string;
};
const scriptDoor = ((): ScriptDoor | undefined => {
  for (const host of generateHomeLan(NET_ESSID).hosts) {
    if (host.kind !== 'machine') continue;
    const { machineId, baseFs } = resolveLanHostIdentity(host, NET_ESSID);
    const installed = parseDpkgVersions(readDpkgStatus(baseFs));
    for (const { spec, port } of hostServices(NET_ESSID, host)) {
      const version = installed.get(spec.package);
      const outcome = version === undefined ? undefined : exploitOutcome(spec.package, version, today);
      if (outcome?.effect !== 'script_exec') continue;
      return { ip: host.ip, port, spec, machineId, tier: outcome.tier, cve: outcome.cve };
    }
  }
  return undefined;
})();

/** The ssh release that rolls a USER-tier script hole — the one a fellow occupant can be
 *  moved onto so a `user` hole reads their home but not their `/root`. Derived, not named,
 *  so a moved world fails loudly here rather than testing a door that drifted. */
const sshScriptHole = ((): { readonly spec: ServiceSpec; readonly version: string } | undefined => {
  const spec = Object.values(SERVICE_CATALOG).find((candidate) => candidate.package === 'openssh-server');
  if (spec === undefined) return undefined;
  for (const release of packageTimeline(spec.package, today)) {
    const outcome = exploitOutcome(spec.package, release.version, today);
    if (outcome?.effect === 'script_exec' && outcome.tier === 'user') {
      return { spec, version: release.version };
    }
  }
  return undefined;
})();

/** The libsystemd release where `systemctl` rolls a ROOT-tier script hole — the one a box is
 *  moved onto so a guest session's `--local` fire is handed `/root`. */
const systemctlScriptHole = ((): { readonly version: string } | undefined => {
  for (const release of packageTimeline('libsystemd', today)) {
    const outcome = localExploitOutcome('systemctl', new Map([['libsystemd', release.version]]), today);
    if (outcome?.effect === 'script_exec' && outcome.tier === 'root') {
      return { version: release.version };
    }
  }
  return undefined;
})();

if (scriptDoor === undefined || sshScriptHole === undefined || systemctlScriptHole === undefined) {
  console.error(`The world is not usable for script holes on game day ${today}:`);
  console.error(`  a shipped script_exec door on ${NET_ESSID}: ${scriptDoor?.ip ?? 'none'}`);
  console.error(`  a user-tier openssh-server script hole:      ${sshScriptHole?.version ?? 'none'}`);
  console.error(`  a root-tier systemctl/libsystemd script hole: ${systemctlScriptHole?.version ?? 'none'}`);
  process.exit(2);
}
const door = scriptDoor;
const sshHole = sshScriptHole;
const systemctlHole = systemctlScriptHole;

const NETWORK_KEY = apGatewayLogWriterKey(NET_ESSID);
const WORLD_RW: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: [],
};
const USER_READ: FilePermissions = { read: ['root', 'user'], write: ['root', 'user'], execute: [] };
const WORLD_PID = { read: ['root', 'user', 'guest'], write: ['root'], execute: [] };
const WORLD_EXEC: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root', 'user', 'guest'],
};

// --- Section 1: a network script fire against the generated script door. ---

const attacker = generateIdentity();
const attackerMachine = computeWorkstationId('rig', attacker.publicKeyHex);
const ATTACKER_OCTET = 50;

/** A file a player REWROTE (its journal content differs from anything the generator makes)
 *  and one a player PLANTED (a path the generator never makes at all). Both /tmp, world rw,
 *  so the door's tier — whatever it is — can read them in step 1 and write the first back in
 *  step 2. */
const REWRITTEN_PATH = '/tmp/report.txt';
const REWRITTEN_CONTENT = `player-rewrote-this-${Date.now()}`;
const PLANTED_PATH = '/tmp/planted.log';
const PLANTED_CONTENT = `player-planted-this-${Date.now()}`;

const fireNet = (over: Record<string, unknown>) =>
  post(
    signRequest(attacker, 'exploitCreateSession', {
      session_id: `script-net-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      essid: NET_ESSID,
      target_ip: door.ip,
      port: door.port,
      caller_machine_id: attackerMachine,
      parent_session_id: null,
      ...over,
    }),
  );

const doorLog = () => readPatch(door.machineId, exploitLogOf(door.spec).path, NETWORK_KEY);

// --- Section 2: a user-tier ssh script hole on a fellow occupant's workstation. ---

const occupant = generateIdentity();
const OCCUPANT_OCTET = 77;
const OCCUPANT_LAN = lanAddressFor(NET_ESSID, OCCUPANT_OCTET);
const OCCUPANT_WS_NAME = 'daisy';
const OCCUPANT_USER = 'mara';
const OCCUPANT_ROOT_HASH = md5('occupant-root-secret');
const OCCUPANT_WS = computeWorkstationId(OCCUPANT_WS_NAME, occupant.publicKeyHex);
const WALLET_PATH = `/home/${OCCUPANT_USER}/.wallet/wallet.dat`;
const WALLET_CONTENT = `key: ${'a'.repeat(64)}`;

const occupantStockFs = buildOccupantWorkstationFs({
  owner_key: occupant.publicKeyHex,
  workstation_username: OCCUPANT_USER,
  workstation_root_hash: OCCUPANT_ROOT_HASH,
});
const occupantInstalled = parseDpkgVersions(readDpkgStatus(occupantStockFs));
const occupantManifest = occupantInstalled.has(sshHole.spec.package)
  ? withPackageVersion(readDpkgStatus(occupantStockFs), sshHole.spec.package, sshHole.version)
  : withPackageEntries(readDpkgStatus(occupantStockFs), [buildEntry(sshHole.spec.package, sshHole.version)]);

// --- Section 3: a guest session's `--local systemctl` on a generated box. ---

const guest = generateIdentity();
const LOCAL_ESSID = 'BEAN-THERE-WIFI';
const localHost = generateHomeLan(LOCAL_ESSID).hosts.find(
  (host) => host.kind === 'machine' && !host.ip.endsWith('.1'),
);
if (localHost === undefined) {
  console.error(`${LOCAL_ESSID} generates no LAN machine`);
  process.exit(2);
}
const LOCAL_BOX = machineIdForLanHost(localHost, LOCAL_ESSID);
const localBase = networkBaseFsForMachineId(LOCAL_ESSID, LOCAL_BOX);
if (localBase === null) {
  console.error(`${LOCAL_ESSID} does not make ${LOCAL_BOX}`);
  process.exit(2);
}
const MSF_PATH = '/tmp/msfconsole';
const GUEST_SESSION = `script-local-guest-${LOCAL_BOX}`;

const fireLocal = (over: Record<string, unknown>) =>
  post(
    signRequest(guest, 'exploitLocalElevate', {
      session_id: `script-local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      machine_id: LOCAL_BOX,
      command: 'systemctl',
      command_path: MSF_PATH,
      parent_session_id: GUEST_SESSION,
      source_ip: null,
      ...over,
    }),
  );

// --- Teardown, run before and after so a crashed run starts from the generated world. ---

const cleanup = async () => {
  for (const machineId of [door.machineId, OCCUPANT_WS, LOCAL_BOX]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  for (const identity of [attacker, occupant, guest]) {
    await sr.from('sessions').delete().eq('player_key', identity.publicKeyHex);
    await sr.from('home_network_occupants').delete().eq('owner_key', identity.publicKeyHex);
  }
  for (const [essid, octet] of [
    [NET_ESSID, ATTACKER_OCTET],
    [NET_ESSID, OCCUPANT_OCTET],
  ] as const) {
    await sr.from('network_lan_leases').delete().eq('essid', essid).eq('octet', octet);
  }
};

const seatOccupant = async (
  identity: ReturnType<typeof generateIdentity>,
  octet: number,
  machineId: string,
  wsName: string,
  username: string,
  rootHash: string,
) => {
  const lease = await sr
    .from('network_lan_leases')
    .upsert({ essid: NET_ESSID, owner_key: identity.publicKeyHex, octet }, { onConflict: 'essid,owner_key' });
  const occ = await sr.from('home_network_occupants').upsert(
    {
      essid: NET_ESSID,
      owner_key: identity.publicKeyHex,
      workstation_machine_id: machineId,
      workstation_username: username,
      workstation_machine_name: wsName,
      workstation_root_hash: rootHash,
    },
    { onConflict: 'essid,owner_key' },
  );
  if (lease.error || occ.error) {
    throw new Error(`seat failed: ${JSON.stringify(lease.error ?? occ.error)}`);
  }
};

const main = async () => {
  console.log(`World day ${today} on ${NET_ESSID}`);
  console.log(
    `Script door: ${door.ip}:${door.port} (${door.spec.service}) → script_exec / ${door.tier}, ` +
      `traces to ${exploitLogOf(door.spec).path}`,
  );
  console.log(`Occupant ssh hole: ${sshHole.spec.package}@${sshHole.version} (user)`);
  console.log(`Local systemctl hole: libsystemd@${systemctlHole.version} (root)\n`);

  await cleanup();
  await seatOccupant(attacker, ATTACKER_OCTET, attackerMachine, 'rig', 'player', md5('attacker-root-secret'));

  // === 1. THE SERVED TREE IS THE BOX AS IT STANDS. ===
  // Two journal rows a player left on the generated box: one rewriting a file, one planting
  // a new one. The old client rebuilt the target with no journal, so neither reached a script.
  for (const [path, content] of [
    [REWRITTEN_PATH, REWRITTEN_CONTENT],
    [PLANTED_PATH, PLANTED_CONTENT],
  ] as const) {
    await seedPatch({
      machineId: door.machineId,
      path,
      content,
      owner: 'user',
      permissions: WORLD_RW,
      writerKey: attacker.publicKeyHex,
    });
  }

  // A fire that names NO script reveals the effect, asks for one, and leaves no line.
  const blind = await fireNet({});
  check(
    'a script hole fired with no script names the CVE, asks for one, and leaves no line',
    blind.status === 200 &&
      field(blind.body, 'effect') === 'script_exec' &&
      field(blind.body, 'needsArg') === true &&
      (await doorLog()) === null,
    `status ${blind.status}, needsArg ${String(field(blind.body, 'needsArg'))}, ` +
      `lines ${linesIn((await doorLog())?.content ?? null).length}`,
  );

  // Step 1: ready to run. The server hands back the box as it stands, and logs the break-in.
  const step1 = await fireNet({ arg: 'exploit.js', script_ready: true });
  const tree = servedTree(step1.body);
  const servedRewritten = tree === undefined ? undefined : fileContent(tree, 'tmp', 'report.txt');
  check(
    'step 1 serves the box AS IT STANDS: the rewritten file reads rewritten, the planted file is there',
    step1.status === 200 &&
      field(step1.body, 'effect') === 'script_exec' &&
      field(step1.body, 'tier') === door.tier &&
      servedRewritten === REWRITTEN_CONTENT &&
      fileContent(tree!, 'tmp', 'planted.log') === PLANTED_CONTENT,
    `status ${step1.status}, served report.txt ${JSON.stringify(servedRewritten)}`,
  );
  check(
    'step 1 leaves exactly one exploit line in the service log',
    linesIn((await doorLog())?.content ?? null).length === 1,
    `${linesIn((await doorLog())?.content ?? null).length} line(s)`,
  );

  // Step 2: the script appended to what step 1 served and sends it back. The player's bytes
  // are kept UNDER the edit — proof the script read the real file, not a regenerated one —
  // and the file's own owner is left alone.
  const edited = `${servedRewritten ?? ''}\n# appended by the script`;
  const step2 = await fireNet({ arg: 'exploit.js', writes: [{ path: REWRITTEN_PATH, content: edited }] });
  const landed = await readPatch(door.machineId, REWRITTEN_PATH, attacker.publicKeyHex);
  check(
    'step 2 lands the served bytes plus the edit, keeping the file’s own owner',
    step2.status === 200 &&
      field(step2.body, 'effect') === 'script_exec' &&
      field(step2.body, 'needsArg') === undefined &&
      landed?.content === edited &&
      landed?.owner === 'user',
    `status ${step2.status}, landed owner ${landed?.owner ?? '-'}, ` +
      `content matches ${String(landed?.content === edited)}`,
  );
  check(
    'a whole script run leaves exactly two exploit lines — one per step',
    linesIn((await doorLog())?.content ?? null).length === 2,
    `${linesIn((await doorLog())?.content ?? null).length} line(s)`,
  );

  // === 2. THE TREE IS FILTERED TO THE GRANTED TIER (a user hole on an occupant's box). ===
  await seatOccupant(occupant, OCCUPANT_OCTET, OCCUPANT_WS, OCCUPANT_WS_NAME, OCCUPANT_USER, OCCUPANT_ROOT_HASH);
  await seedPatch({
    machineId: OCCUPANT_WS,
    path: DPKG_STATUS_PATH,
    content: occupantManifest,
    owner: DPKG_STATUS_OWNER,
    permissions: DPKG_STATUS_PERMISSIONS,
    writerKey: occupant.publicKeyHex,
  });
  await seedPatch({
    machineId: OCCUPANT_WS,
    path: pidfilePath(sshHole.spec),
    content: formatPidfileContent(sshHole.spec, sshHole.spec.defaultPort),
    owner: 'root',
    permissions: WORLD_PID,
    writerKey: occupant.publicKeyHex,
  });
  // The occupant's own wallet key: an ordinary file, user-readable, in their home.
  await seedPatch({
    machineId: OCCUPANT_WS,
    path: WALLET_PATH,
    content: WALLET_CONTENT,
    owner: OCCUPANT_USER,
    permissions: USER_READ,
    writerKey: occupant.publicKeyHex,
  });

  const occStep1 = await post(
    signRequest(attacker, 'exploitCreateSession', {
      session_id: `script-occ-${Date.now()}`,
      essid: NET_ESSID,
      target_ip: OCCUPANT_LAN,
      port: sshHole.spec.defaultPort,
      caller_machine_id: attackerMachine,
      parent_session_id: null,
      arg: 'exploit.js',
      script_ready: true,
    }),
  );
  const occTree = servedTree(occStep1.body);
  check(
    'a user hole on a fellow occupant’s box serves their user-readable wallet key and NOT /root',
    occStep1.status === 200 &&
      field(occStep1.body, 'tier') === 'user' &&
      occTree !== undefined &&
      fileContent(occTree, 'home', OCCUPANT_USER, '.wallet', 'wallet.dat') === WALLET_CONTENT &&
      nodeAt(occTree, 'root') === undefined,
    `status ${occStep1.status}, wallet ${JSON.stringify(occTree && fileContent(occTree, 'home', OCCUPANT_USER, '.wallet', 'wallet.dat'))}, ` +
      `/root ${occTree && nodeAt(occTree, 'root') === undefined ? 'pruned' : 'present'}`,
  );

  // === 3. `--local` SERVES AT THE GRANTED TIER, NOT THE CALLER'S (root hole, guest shell). ===
  await sr.from('sessions').delete().eq('player_key', guest.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', LOCAL_BOX);
  const localSeed = await sr.from('patches').insert(
    [
      {
        machine_id: LOCAL_BOX,
        path: DPKG_STATUS_PATH,
        content: withPackageVersion(readDpkgStatus(localBase), 'libsystemd', systemctlHole.version),
        owner: DPKG_STATUS_OWNER,
        permissions: DPKG_STATUS_PERMISSIONS,
        node_type: 'file',
        writer_key: guest.publicKeyHex,
      },
      {
        machine_id: LOCAL_BOX,
        path: MSF_PATH,
        content: binaryStub('msfconsole'),
        owner: 'guest',
        permissions: WORLD_EXEC,
        node_type: 'file',
        writer_key: guest.publicKeyHex,
      },
    ],
  );
  const guestSession = await sr.from('sessions').insert({
    session_id: GUEST_SESSION,
    player_key: guest.publicKeyHex,
    machine_id: LOCAL_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: LOCAL_ESSID,
    created_at: '2020-01-01T00:00:00.000Z',
  });
  if (localSeed.error || guestSession.error) {
    console.error('local seed failed:', localSeed.error ?? guestSession.error);
    process.exit(1);
  }

  const localStep1 = await fireLocal({ arg: 'exploit.js', script_ready: true });
  const localTree = servedTree(localStep1.body);
  const localAuth = await readPatch(LOCAL_BOX, '/var/log/auth.log', NETWORK_KEY);
  const localKern = await readPatch(LOCAL_BOX, '/var/log/kern.log', NETWORK_KEY);
  check(
    'a guest’s --local root-hole fire is served a tree carrying /root, and leaves no line',
    localStep1.status === 200 &&
      field(localStep1.body, 'tier') === 'root' &&
      localTree !== undefined &&
      nodeAt(localTree, 'root')?.kind === 'directory' &&
      localAuth === null &&
      localKern === null,
    `status ${localStep1.status}, tier ${String(field(localStep1.body, 'tier'))}, ` +
      `/root ${localTree && nodeAt(localTree, 'root')?.kind === 'directory' ? 'served' : 'absent'}, ` +
      `auth ${localAuth === null ? 'empty' : 'written'}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed  (game day ${today})`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
