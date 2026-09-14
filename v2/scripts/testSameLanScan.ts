// Wire-payload smoke for the own-LAN scan — an `nmap <ip>` on the player's own LAN,
// resolved server-side against that machine's journal. Drives the REAL /api/network
// (resolveSameLanScan) + /api/patches endpoints against a running `vercel dev` +
// supabase, seeding the writer's root session on each target via service_role.
//
// Net-new under test (the locally-untypechecked api/ runtime): a single-IP scan of a box
// the ACCESS POINT owns regenerates it from the essid, replays its journal over the
// seeded base, gates it on canBoot, and reports the ports of the box as it IS.
//
// Both kinds of box, because they differ in the tree they are seeded from and the reader
// they answer through. An NPC SIBLING (checks 1-5) closes the four recorded faces off ONE
// resolution — a patched package's new version and the CVE that stops applying to it, a
// planted listener, a stopped daemon, and a brick. The `.1` GATEWAY (checks 6-9) is the
// box every occupant shares, read at the `sameLAN` vantage: its own services, a filter
// that closes one of them, and never the NAT forwards behind it.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testSameLanScan.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable sibling.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { generateHomeLan, type LanHost } from '../src/core/generation/generateHomeLan';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { buildRemoteHostFs } from '../src/core/generation/remoteHostFs';
import { buildApGatewayBaseFs } from '../src/core/generation/routerFs';
import { machineIdForLanHost } from '../src/core/generation/lanHostIdentity';
import { hostMachineId } from '../src/core/generation/remoteHostId';
import {
  readRulesV4,
  withForward,
  withInputDeny,
  RULES_V4_OWNER,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from '../src/core/network/iptablesRules';
import {
  formatListenerContent,
  listenerPidfileName,
  pidfilePath,
  readOpenPorts,
  readRunningProcesses,
} from '../src/core/services/pidfile';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus';
import { upgradeStatusFor } from '../src/core/cve/packageTimeline';
import { displayVersion } from '../src/core/packages/packageVersions';
import { serviceByName } from '../src/core/services/serviceCatalog';
import { gameDayAt } from '../src/core/cve/worldClock';
import { asEpochMs } from '../src/core/types';

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

type ScannedPort = { port?: number; service?: string; version?: string; cve?: string };

const entriesOf = (body: unknown): readonly ScannedPort[] =>
  (body as { ports?: readonly ScannedPort[] } | null)?.ports ?? [];

const portsOf = (body: unknown): readonly number[] =>
  entriesOf(body)
    .map((entry) => entry.port)
    .filter((port): port is number => typeof port === 'number');

const foundOf = (body: unknown): boolean => (body as { found?: boolean } | null)?.found === true;

// --- The world, on the day the SERVER is standing on. The endpoint reads its own clock,
//     so the candidate has to be chosen against that same day or the CVE check asks about
//     a different world than the one that answers. ---
const GAME_DAY = gameDayAt(asEpochMs(Date.now()));

/** A sibling running a service whose installed version has a LIVE hole today and whose
 *  fix has already shipped — the exact situation the scan used to lie about. Searched
 *  rather than named: which package is inside its window is a seeded roll against a
 *  window only 1-2 days wide, so no fixed ESSID can be counted on to hold one. */
const findCandidate = () => {
  for (const essid of crackableEssidPool) {
    for (const host of generateHomeLan(essid).hosts) {
      if (host.kind !== 'machine') continue;
      const seededFs = buildRemoteHostFs(essid, host);
      const installed = parseDpkgVersions(readDpkgStatus(seededFs));
      for (const exposed of readOpenPorts(seededFs, { gameDay: GAME_DAY })) {
        const pkg = serviceByName(exposed.service)?.package;
        if (exposed.cve === undefined || pkg === undefined) continue;
        const version = installed.get(pkg);
        if (version === undefined) continue;
        const status = upgradeStatusFor(pkg, version, GAME_DAY);
        if (status.kind !== 'upgradable') continue;
        return { essid, host, pkg, exposed, fixed: status.target, seededFs };
      }
    }
  }
  return null;
};

const candidate = findCandidate();
if (candidate === null) {
  console.error(`no sibling holds a vulnerable service with a shipped fix on game day ${GAME_DAY}`);
  process.exit(2);
}

const { essid: ESSID, host: SIBLING, pkg: PKG, exposed: EXPOSED, fixed: FIXED } = candidate;
const SIBLING_ID = hostMachineId(SIBLING, ESSID);
const VULNERABLE_PORT = EXPOSED.port;
const FIXED_DISPLAY = displayVersion(PKG, FIXED);

/** A seeded daemon on the box whose door the stop check closes — read off the box, not
 *  named, so it keeps meaning what it says when the generator re-rolls. */
const seededService = (host: LanHost) => {
  for (const running of readRunningProcesses(buildRemoteHostFs(ESSID, host))) {
    if (running.kind === 'service') return running;
  }
  return null;
};
const STOPPABLE = seededService(SIBLING);
if (STOPPABLE === null || STOPPABLE.kind !== 'service') {
  console.error('the chosen sibling runs no seeded service to stop');
  process.exit(2);
}

const PLANTED_PORT = 4444;
const PLANTED_PIDFILE = `/var/run/${listenerPidfileName(PLANTED_PORT)}`;
const VMLINUZ = '/boot/vmlinuz';
const ROOT_ONLY = { read: ['root'], write: ['root'], execute: [] };
const FORWARDED_PORT = 8080;

/** The access point's own gateway on the same LAN — a different base tree and a different
 *  vantage, resolved through the same action. */
const GATEWAY = generateHomeLan(ESSID).hosts.find(
  (host) => host.ip === `${generateHomeLan(ESSID).subnet}.1`,
);
if (GATEWAY === undefined) {
  console.error(`${ESSID} has no gateway at .1`);
  process.exit(2);
}
const GATEWAY_ID = machineIdForLanHost(GATEWAY, ESSID);
const GATEWAY_FS = buildApGatewayBaseFs(ESSID);
const GATEWAY_PORT = readOpenPorts(GATEWAY_FS)[0]?.port;
if (GATEWAY_PORT === undefined) {
  console.error('the access point gateway runs no seeded service');
  process.exit(2);
}

const alice = generateIdentity();

const scanAt = (target: string) =>
  post(NETWORK, signRequest(alice, 'resolveSameLanScan', { essid: ESSID, target }));

const scan = () => scanAt(SIBLING.ip);

const writeTo = (
  machineId: string,
  path: string,
  content: string,
  owner: string,
  permissions: unknown,
) =>
  post(
    PATCHES,
    signRequest(alice, 'upsertPatch', {
      machine_id: machineId,
      path,
      content,
      owner,
      permissions,
      node_type: 'file',
    }),
  );

const write = (path: string, content: string, owner: string, permissions: unknown) =>
  writeTo(SIBLING_ID, path, content, owner, permissions);

const removeFrom = (machineId: string, path: string) =>
  post(PATCHES, signRequest(alice, 'removePatch', { machine_id: machineId, path, owner: 'root' }));

const remove = (path: string) => removeFrom(SIBLING_ID, path);

console.log(
  `world day ${GAME_DAY} — ${ESSID} ${SIBLING.hostname} (${SIBLING.ip}) ` +
    `${PKG} ${EXPOSED.version} ${EXPOSED.cve} → ${FIXED_DISPLAY}`,
);

// Clean slate, then seed alice's own ROOT session on the sibling (as her
// `ssh root@<sibling>` would leave it) so her writes to its journal pass the gate.
await sr.from('patches').delete().eq('machine_id', SIBLING_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('sessions').insert({
  session_id: `ssh-alice-sibling-${SIBLING_ID}`,
  player_key: alice.publicKeyHex,
  machine_id: SIBLING_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});

// 1. BASELINE — an untouched sibling scans as the box the world shipped: the vulnerable
//    port is open, and the CVE against it is reported.
const s1 = await scan();
const vuln1 = entriesOf(s1.body).find((entry) => entry.port === VULNERABLE_PORT);
check(
  'baseline: nmap <sibling> reports the shipped version and its live CVE',
  s1.status === 200 &&
    foundOf(s1.body) &&
    vuln1?.version === EXPOSED.version &&
    vuln1?.cve === EXPOSED.cve,
  `status=${s1.status} found=${foundOf(s1.body)} version=${vuln1?.version ?? '-'} cve=${vuln1?.cve ?? '-'}`,
);

// 2. THE PATCH — alice upgrades the package on the sibling's journal, as `apt upgrade`
//    writes it. The scan must follow the manifest, not the seed.
const w2 = await write(
  DPKG_STATUS_PATH,
  withPackageVersion(readDpkgStatus(candidate.seededFs), PKG, FIXED),
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PERMISSIONS,
);
const s2 = await scan();
const vuln2 = entriesOf(s2.body).find((entry) => entry.port === VULNERABLE_PORT);
check(
  'patched: nmap <sibling> reports the NEW version and no CVE',
  w2.status === 200 && s2.status === 200 && vuln2?.version === FIXED_DISPLAY && vuln2?.cve === undefined,
  `write=${w2.status} scan=${s2.status} version=${vuln2?.version ?? '-'} cve=${vuln2?.cve ?? 'none'}`,
);

// 3. A PLANTED DOOR — a listener alice leaves behind shows as an open unknown port, to
//    her and to every other occupant scanning this address.
const w3 = await write(
  PLANTED_PIDFILE,
  formatListenerContent({ port: PLANTED_PORT, user: 'root', userType: 'root' }),
  'root',
  ROOT_ONLY,
);
const s3 = await scan();
check(
  'planted listener: nmap <sibling> shows :4444 as an open unknown port',
  w3.status === 200 && s3.status === 200 && portsOf(s3.body).includes(PLANTED_PORT),
  `write=${w3.status} scan=${s3.status} ports=[${portsOf(s3.body).join(',')}]`,
);

// 4. A STOPPED DAEMON — `systemctl stop` tombstones the pidfile, and the door closes on
//    the scan too. The lie this one told was about the player's OWN action.
const r4 = await remove(pidfilePath(STOPPABLE.spec));
const s4 = await scan();
check(
  `stopped daemon: nmap <sibling> drops :${STOPPABLE.port}, keeps the planted :4444`,
  r4.status === 200 &&
    s4.status === 200 &&
    !portsOf(s4.body).includes(STOPPABLE.port) &&
    portsOf(s4.body).includes(PLANTED_PORT),
  `stop=${r4.status} scan=${s4.status} ports=[${portsOf(s4.body).join(',')}]`,
);

// 5. BRICK — rm /boot/vmlinuz: the box stops answering entirely (host-down, no ports),
//    rather than reporting up with a table of doors it no longer holds.
const r5 = await remove(VMLINUZ);
const s5 = await scan();
check(
  'brick: rm /boot/vmlinuz → nmap <sibling> host-down, no ports',
  r5.status === 200 && s5.status === 200 && !foundOf(s5.body) && portsOf(s5.body).length === 0,
  `brick=${r5.status} scan=${s5.status} found=${foundOf(s5.body)} ports=[${portsOf(s5.body).join(',')}]`,
);

// --- The ACCESS POINT's own gateway at `.1`. Same action, same journal replay, read at
//     the `sameLAN` vantage: its own services, never the NAT forwards behind it. It is
//     the one box on this LAN every occupant shares, so what any of them writes to it is
//     what all of them scan. ---
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);
await sr.from('patches').delete().eq('machine_id', GATEWAY_ID);
await sr.from('sessions').insert({
  session_id: `ssh-alice-gateway-${GATEWAY_ID}`,
  player_key: alice.publicKeyHex,
  machine_id: GATEWAY_ID,
  credentials: { username: 'root', userType: 'root' },
  kind: 'ssh',
  essid: ESSID,
});

// 6. BASELINE — the gateway answers with the services it is seeded to run.
const g1 = await scanAt(GATEWAY.ip);
check(
  `gateway baseline: nmap ${GATEWAY.ip} reports its own :${GATEWAY_PORT}`,
  g1.status === 200 && foundOf(g1.body) && portsOf(g1.body).includes(GATEWAY_PORT),
  `status=${g1.status} found=${foundOf(g1.body)} ports=[${portsOf(g1.body).join(',')}]`,
);

// 7. THE FILTER — `snmpset <gw> <rw> inputPort.<port>=deny`. The port closes to the
//    network while the daemon keeps running, and the LAN scan must say so: this is the
//    face where the scan of the shared gateway and the scan of its public IP disagreed.
const w7 = await writeTo(
  GATEWAY_ID,
  RULES_V4_PATH,
  withInputDeny(readRulesV4(GATEWAY_FS), GATEWAY_PORT, true),
  RULES_V4_OWNER,
  RULES_V4_PERMISSIONS,
);
const g2 = await scanAt(GATEWAY.ip);
check(
  `gateway filter: inputPort.${GATEWAY_PORT}=deny → nmap drops :${GATEWAY_PORT}`,
  w7.status === 200 && g2.status === 200 && !portsOf(g2.body).includes(GATEWAY_PORT),
  `write=${w7.status} scan=${g2.status} ports=[${portsOf(g2.body).join(',')}]`,
);

// 8. THE FORWARD — a NAT forward is how the box BEHIND it is reached from the internet,
//    not a door on the gateway. Listing it here would hand any occupant the public
//    exposure of every neighbour off a scan of their own LAN.
const w8 = await writeTo(
  GATEWAY_ID,
  RULES_V4_PATH,
  withForward(readRulesV4(GATEWAY_FS), FORWARDED_PORT, {
    internalIp: SIBLING.ip,
    internalPort: PLANTED_PORT,
  }),
  RULES_V4_OWNER,
  RULES_V4_PERMISSIONS,
);
const g3 = await scanAt(GATEWAY.ip);
check(
  `gateway vantage: a forward on :${FORWARDED_PORT} stays off the LAN scan`,
  w8.status === 200 && g3.status === 200 && !portsOf(g3.body).includes(FORWARDED_PORT),
  `write=${w8.status} scan=${g3.status} ports=[${portsOf(g3.body).join(',')}]`,
);

// 9. BRICK — the box the whole network routes through is no exception to the boot gate.
const r9 = await removeFrom(GATEWAY_ID, VMLINUZ);
const g4 = await scanAt(GATEWAY.ip);
check(
  'gateway brick: rm /boot/vmlinuz → nmap <gateway> host-down, no ports',
  r9.status === 200 && g4.status === 200 && !foundOf(g4.body) && portsOf(g4.body).length === 0,
  `brick=${r9.status} scan=${g4.status} found=${foundOf(g4.body)} ports=[${portsOf(g4.body).join(',')}]`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', SIBLING_ID);
await sr.from('patches').delete().eq('machine_id', GATEWAY_ID);
await sr.from('sessions').delete().eq('player_key', alice.publicKeyHex);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
