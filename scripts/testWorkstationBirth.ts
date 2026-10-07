// Wire-payload smoke for a workstation's FIRST BOOT — the services a box is born
// running, written by the real client provisioning through the real /api/patches, and
// then found by a neighbour through the real /api/network scan and /api/sessions sweep.
// Runs against a live `vercel dev` + supabase.
//
// No api/ code changed for this: the point is that the server needs none. What it
// proves is that the server's rebuild of A's box — base tree from A's identity, A's
// journal replayed over it — runs exactly the services, at exactly the versions, that
// A's own client wrote at first boot:
//   - the first boot's writes land in A's journal, marker last.
//   - B, on A's WiFi, scans A and gets the same open ports, versions and live holes
//     that A's client reads off its own tree.
//   - when the draw gave A `sshd`, B's hydra earns A's `guest` account over it.
//   - a second boot of the same box writes nothing.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testWorkstationBirth.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { lanAddressFor } from '../src/core/network/lanAddress.js';
import {
  buildWorkstationBaseFs,
  workstationGuestPassword,
} from '../src/core/generation/workstationFs.js';
import { applyPatches } from '../src/core/filesystem/applyPatches.js';
import { createPatchApi, readOwnPatches, type PatchClientDeps } from '../src/adapters/patchApi.js';
import { FIRST_BOOT_MARKER, runFirstBoot, startingServices } from '../src/core/boot/firstBoot.js';
import { readOpenPorts, PIDFILE_PERMISSIONS, type OpenPort } from '../src/core/services/pidfile.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { WORDLIST_PATH, formatWordlist } from '../src/core/wordlist/defaultWordlist.js';
import { md5 } from '../src/core/generation/md5.js';
import { asEpochMs, asMachineId } from '../src/core/types.js';
import type { Directory } from '../src/core/filesystem/types.js';

const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

/** A seed that cannot be built must stop the run rather than soften into a passing
 *  check against an unmodified world. */
const failFast = (label: string, error: { readonly message: string } | null): void => {
  if (error === null) return;
  console.error(`FATAL: ${label} failed: ${error.message}`);
  process.exit(1);
};

const postTo = async (endpoint: string, envelope: unknown) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const textOf = (body: unknown): string =>
  typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);

const portsIn = (body: unknown): readonly OpenPort[] =>
  (body as { ports?: OpenPort[] } | null)?.ports ?? [];

const crackedIn = (body: unknown): readonly { username?: string; password: string }[] =>
  (body as { cracked?: { username?: string; password: string }[] } | null)?.cracked ?? [];

/** One line per port, in port order, so two readings compare as text. */
const describePorts = (ports: readonly OpenPort[]): string =>
  [...ports]
    .sort((left, right) => left.port - right.port)
    .map((open) => `${open.port}/${open.service} ${open.version ?? '-'} ${open.cve ?? '-'}`)
    .join(' | ');

// --- A defender whose draw includes `sshd` and at least one more service, so the scan
//     has more than one door to agree about and the sweep has a shell door to try. ---
const defender = (() => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const candidate = generateIdentity();
    const names = startingServices(candidate.publicKeyHex).map((service) => service.daemon.name);
    if (names.includes('sshd') && names.length >= 2) return candidate;
  }
  console.error('No generated identity drew sshd plus another service — rerun.');
  process.exit(2);
})();
const attacker = generateIdentity();

const ESSID = 'BIRTH-CHECK-WIFI';
const DEFENDER_CONFIG = {
  machineName: 'newborn',
  username: 'gilfoyle',
  rootPassword: 'defender-root-secret',
};
const DEFENDER_WS = computeWorkstationId(DEFENDER_CONFIG.machineName, defender.publicKeyHex);
const DEFENDER_OCTET = 23;
const DEFENDER_LAN_IP = lanAddressFor(ESSID, DEFENDER_OCTET);

const ATTACKER_HOSTNAME = 'cracklab';
const ATTACKER_WS = computeWorkstationId(ATTACKER_HOSTNAME, attacker.publicKeyHex);
const ATTACKER_OCTET = 61;

const drawn = startingServices(defender.publicKeyHex).map((service) => service.daemon.name);
console.log(`defender draws: ${drawn.join(', ')}`);

const clean = async () => {
  await sr.from('home_network_occupants').delete().eq('essid', ESSID);
  await sr.from('network_lan_leases').delete().eq('essid', ESSID);
  for (const id of [DEFENDER_WS, ATTACKER_WS]) {
    await sr.from('patches').delete().eq('machine_id', id);
  }
};

await clean();

// Both players joined the WiFi and were issued leases.
failFast(
  'lease seed',
  (
    await sr.from('network_lan_leases').insert([
      { essid: ESSID, owner_key: defender.publicKeyHex, octet: DEFENDER_OCTET },
      { essid: ESSID, owner_key: attacker.publicKeyHex, octet: ATTACKER_OCTET },
    ])
  ).error,
);
failFast(
  'occupancy seed',
  (
    await sr.from('home_network_occupants').insert([
      {
        essid: ESSID,
        owner_key: defender.publicKeyHex,
        workstation_machine_id: DEFENDER_WS,
        workstation_username: DEFENDER_CONFIG.username,
        workstation_machine_name: DEFENDER_CONFIG.machineName,
        workstation_root_hash: md5(DEFENDER_CONFIG.rootPassword),
      },
      {
        essid: ESSID,
        owner_key: attacker.publicKeyHex,
        workstation_machine_id: ATTACKER_WS,
        workstation_username: 'mallory',
        workstation_machine_name: ATTACKER_HOSTNAME,
        workstation_root_hash: md5('attacker-root-secret'),
      },
    ])
  ).error,
);
// The attacker's wordlist, grown the only way a wordlist grows: by writing to a box.
failFast(
  'attacker wordlist seed',
  (
    await sr.from('patches').upsert(
      {
        machine_id: ATTACKER_WS,
        path: WORDLIST_PATH,
        writer_key: attacker.publicKeyHex,
        content: formatWordlist(['hunter2', workstationGuestPassword(defender.publicKeyHex)]),
        owner: 'root',
        node_type: 'file',
        permissions: PIDFILE_PERMISSIONS,
      },
      { onConflict: 'machine_id,path,writer_key' },
    )
  ).error,
);

// --- The defender's box boots for the first time, exactly as `resolveBootCheck` runs
//     it in the browser: root's writes, and the journal read back between services. ---
const ownBox: PatchClientDeps = {
  identity: defender,
  machineId: asMachineId(DEFENDER_WS),
  owner: DEFENDER_CONFIG.username,
  tier: 'user',
  endpoint: PATCHES,
};
const seeded = buildWorkstationBaseFs(defender.publicKeyHex, DEFENDER_CONFIG);
const readTree = async (): Promise<Directory | null> => {
  const read = await readOwnPatches(ownBox);
  return read.ok ? applyPatches(seeded, read.patches) : null;
};
const boot = () =>
  runFirstBoot({
    identity: defender,
    hostname: DEFENDER_CONFIG.machineName,
    now: () => asEpochMs(Date.now()),
    patches: createPatchApi({ ...ownBox, owner: 'root', tier: 'root' }),
    readTree,
  });

await boot();

// --- 1. The birth landed in A's journal, marker and all. ---
const afterBirth = await readOwnPatches(ownBox);
const birthRows = afterBirth.ok ? afterBirth.patches : [];
check(
  '1. the first boot writes into the defender journal, marker last',
  afterBirth.ok && birthRows.at(-1)?.path === FIRST_BOOT_MARKER,
  `${birthRows.length} row(s), last ${birthRows.at(-1)?.path}`,
);

// --- 2. B's scan of A sees exactly what A's own client reads off its tree. ---
const clientTree = await readTree();
const clientPorts =
  clientTree === null
    ? []
    : readOpenPorts(clientTree, { gameDay: gameDayAt(asEpochMs(Date.now())) });
const scanned = await postTo(
  NETWORK,
  await signRequest(attacker, 'resolveOccupantScan', { essid: ESSID, target: DEFENDER_LAN_IP }),
);
const scannedPorts = portsIn(scanned.body);
check(
  '2. a neighbour scan finds every drawn service at the version the first boot wrote',
  scanned.status === 200 &&
    clientPorts.length === drawn.length &&
    clientPorts.every((open) => open.version !== undefined) &&
    describePorts(scannedPorts) === describePorts(clientPorts),
  `scan: ${describePorts(scannedPorts)}  ||  client: ${describePorts(clientPorts)}`,
);

// --- 3. The guest account is reachable over the sshd the box was born running. ---
const sweep = await postTo(
  SESSIONS,
  await signRequest(attacker, 'hydraCrack', {
    essid: ESSID,
    target_ip: DEFENDER_LAN_IP,
    service: 'ssh',
    caller_machine_id: ATTACKER_WS,
    source_ip: '10.0.0.1',
  }),
);
const guest = crackedIn(sweep.body).find((account) => account.username === 'guest');
check(
  '3. hydra earns the guest account over the born sshd',
  sweep.status === 200 && guest?.password === workstationGuestPassword(defender.publicKeyHex),
  `${sweep.status} ${textOf(sweep.body).slice(0, 160)}`,
);

// --- 4. A second boot is not a second birth. ---
const countRows = async (): Promise<number> => {
  const { count } = await sr
    .from('patches')
    .select('path', { count: 'exact', head: true })
    .eq('machine_id', DEFENDER_WS)
    .eq('writer_key', defender.publicKeyHex);
  return count ?? -1;
};
const rowsBefore = await countRows();
const contentBefore = textOf(await readOwnPatches(ownBox));
await boot();
const contentAfter = textOf(await readOwnPatches(ownBox));
check(
  '4. booting the born box again writes nothing',
  rowsBefore === (await countRows()) && contentBefore === contentAfter,
  `${rowsBefore} defender row(s) before and after`,
);

await clean();

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
