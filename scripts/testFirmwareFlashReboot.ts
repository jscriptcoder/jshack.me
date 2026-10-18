// Wire-check for a router's firmware flash: a write that moves an access point gateway's
// firmware row in `/var/lib/dpkg/status` reboots the gateway, in the same request that
// writes the row. Drives the REAL /api/patches endpoint against a running `vercel dev` +
// supabase, seeding session rows via service_role (as the doors would).
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - TWO PLAYERS on one gateway — the flasher at root, a bystander below it. The flash
//     ends both rows, which is the claim a handler test cannot make, because there the
//     other player is a fixture and the rows are never really updated.
//   - The flasher's own row ends too, so their next write is refused at the server: a
//     tampered client that skipped the hop drop still has no shell behind it.
//   - The gateway comes back carrying a fresh boot id, and keeps a `kern.log` line naming
//     the address the flasher's login came from — read back off their session row, the
//     column the patch endpoint's session lookup did not used to select.
//   - A ROLLBACK also leaves the `dpkg.log` line, written by the server from the manifest
//     before and after, under the network's own key — the line `apt` can no longer send
//     itself, since the reboot has already ended the session that would send it.
//   - A write that moves only a service row reboots nothing: both rows stay open and no
//     boot id is written.
//
// Usage (with supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFirmwareFlashReboot.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env / no usable gateway.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { BOOT_ID_PATH } from '../src/core/boot/bootId.js';
import { KERN_LOG_PATH } from '../src/core/logging/kernLog.js';
import { DPKG_LOG_PATH } from '../src/core/logging/dpkgLog.js';
import { buildApGatewayBaseFs } from '../src/core/generation/routerFs.js';
import { seedApGatewayHostname } from '../src/core/generation/gatewayHostname.js';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../src/core/packages/dpkgStatus.js';
import { isFirmwarePackage } from '../src/core/packages/packageVersions.js';
import { packageTimeline } from '../src/core/cve/packageTimeline.js';
import { gameDayAt } from '../src/core/cve/worldClock.js';
import { asEpochMs } from '../src/core/types.js';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(PATCHES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

// --- The gateway and what it runs --------------------------------------------------
const ESSID = 'FLASH-LAB-7';
const GATEWAY = computeApGatewayId(ESSID);
const BASE_MANIFEST = readDpkgStatus(buildApGatewayBaseFs(ESSID));
const installed = parseDpkgVersions(BASE_MANIFEST);
const firmwareKey = [...installed.keys()].find((key) => isFirmwarePackage(key));
const servicePackage = [...installed.keys()].find((key) => key === 'openssh-server');
const baseFirmware = firmwareKey === undefined ? undefined : installed.get(firmwareKey);
const today = gameDayAt(asEpochMs(Date.now()));
// The newest image the repo holds today: an `apt upgrade` lands here, and rolling back
// from it to the generated image walks the firmware BACKWARDS.
const newestFirmware =
  firmwareKey === undefined ? undefined : packageTimeline(firmwareKey, today).at(-1)?.version;
if (
  firmwareKey === undefined ||
  baseFirmware === undefined ||
  newestFirmware === undefined ||
  newestFirmware === baseFirmware ||
  servicePackage === undefined
) {
  console.error(`No gateway firmware with a newer release to flash for ESSID ${ESSID}`);
  process.exit(2);
}

// --- The parties -------------------------------------------------------------------
const flasher = generateIdentity();
const bystander = generateIdentity();
// Where the flasher's login onto the gateway came from — the address the door stamps on
// the row, and the one both log lines must name.
const FLASHER_LOGIN_IP = '192.168.1.37';

const FLASHER_SESSION = 'flash-wire-flasher';
const BYSTANDER_SESSION = 'flash-wire-bystander';
const ALL_IDS = [FLASHER_SESSION, BYSTANDER_SESSION];

const seedSessions = async () => {
  await sr.from('sessions').delete().in('session_id', ALL_IDS);
  const { error } = await sr.from('sessions').insert([
    {
      session_id: FLASHER_SESSION,
      player_key: flasher.publicKeyHex,
      machine_id: GATEWAY,
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: null,
      source_ip: FLASHER_LOGIN_IP,
      kind: 'exploit',
      essid: ESSID,
    },
    {
      session_id: BYSTANDER_SESSION,
      player_key: bystander.publicKeyHex,
      machine_id: GATEWAY,
      credentials: { username: 'admin', userType: 'user' },
      parent_session_id: null,
      source_ip: '192.168.1.52',
      kind: 'ssh',
      essid: ESSID,
    },
  ]);
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

type Row = {
  readonly session_id: string;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
};

const readRows = async (): Promise<readonly Row[]> => {
  const { data } = await sr
    .from('sessions')
    .select('session_id, ended_at, end_reason')
    .in('session_id', ALL_IDS);
  return (data as readonly Row[] | null) ?? [];
};

const rebootedRows = (rows: readonly Row[]): number =>
  rows.filter((row) => row.ended_at !== null && row.end_reason === 'rebooted').length;
const openRows = (rows: readonly Row[]): number =>
  rows.filter((row) => row.ended_at === null).length;

const journalRows = async (
  path: string,
): Promise<readonly { content: string | null; writer_key: string }[]> => {
  const { data } = await sr
    .from('patches')
    .select('content, writer_key')
    .eq('machine_id', GATEWAY)
    .eq('path', path);
  return (data as readonly { content: string | null; writer_key: string }[] | null) ?? [];
};

const linesOf = (rows: readonly { content: string | null }[]): readonly string[] =>
  rows
    .flatMap((row) => (row.content ?? '').trimEnd().split('\n'))
    .filter((line) => line.length > 0);

const bootId = async (): Promise<string | null> => {
  const rows = await journalRows(BOOT_ID_PATH);
  return rows[0]?.content?.trim() ?? null;
};

const writeManifest = (content: string) =>
  post(
    signRequest(flasher, 'upsertPatch', {
      machine_id: GATEWAY,
      path: DPKG_STATUS_PATH,
      content,
      owner: DPKG_STATUS_OWNER,
      permissions: DPKG_STATUS_PERMISSIONS,
      node_type: 'file',
    }),
  );

// Gateways are ESSID-seeded, so their machine id is the same every run: clear at SETUP
// as well as teardown, or a crashed run's rows read as this one's.
const wipeWorld = async () => {
  await sr.from('sessions').delete().in('session_id', ALL_IDS);
  await sr.from('patches').delete().eq('machine_id', GATEWAY);
};

await wipeWorld();
console.log(
  `Gateway ${GATEWAY} (${ESSID}) runs ${firmwareKey} ${baseFirmware}; newest is ${newestFirmware}\n`,
);

// === 1. Moving a service row reboots nothing. ===
await seedSessions();
const serviceOnly = await writeManifest(withPackageVersion(BASE_MANIFEST, servicePackage, '9.8.0'));
const afterService = await readRows();
check(
  'a write moving only a service row is accepted',
  serviceOnly.status === 200,
  `status=${serviceOnly.status} body=${JSON.stringify(serviceOnly.body)}`,
);
check(
  'and leaves both players on the gateway',
  openRows(afterService) === 2,
  `open=${openRows(afterService)}/2`,
);
check('and writes no boot id', (await bootId()) === null, `boot-id=${await bootId()}`);

// === 2. Flashing the firmware forward reboots the gateway under both players. ===
const forward = await writeManifest(withPackageVersion(BASE_MANIFEST, firmwareKey, newestFirmware));
const afterForward = await readRows();
check(
  'a write moving the firmware forward is accepted',
  forward.status === 200,
  `status=${forward.status} body=${JSON.stringify(forward.body)}`,
);
check(
  "both players' sessions are ended as a reboot, the flasher's own included",
  rebootedRows(afterForward) === 2,
  `rows=${JSON.stringify(afterForward.map((row) => [row.session_id, row.end_reason]))}`,
);
const firstBoot = await bootId();
check('the gateway comes back carrying a boot id', firstBoot !== null, `boot-id=${firstBoot}`);
const kernAfterForward = await journalRows(KERN_LOG_PATH);
const forwardLine = linesOf(kernAfterForward).at(-1) ?? '';
check(
  "the reboot is in the gateway's kern.log, under the network's key",
  kernAfterForward.length === 1 && kernAfterForward[0]?.writer_key === apGatewayLogWriterKey(ESSID),
  `${kernAfterForward.length} row(s) under ${kernAfterForward[0]?.writer_key ?? '-'}`,
);
check(
  "naming the gateway and the address the flasher's login came from",
  forwardLine.includes(` ${seedApGatewayHostname(ESSID)} kernel: [reboot]`) &&
    forwardLine.includes(`from ${FLASHER_LOGIN_IP} `),
  forwardLine.length === 0 ? '(no line)' : forwardLine,
);
check(
  'a forward flash leaves no rollback in dpkg.log',
  linesOf(await journalRows(DPKG_LOG_PATH)).length === 0,
  `${linesOf(await journalRows(DPKG_LOG_PATH)).length} line(s)`,
);

// The flasher's row is really gone at the server: a client that never dropped its hop
// has nothing behind it.
const stale = await writeManifest(withPackageVersion(BASE_MANIFEST, firmwareKey, baseFirmware));
check(
  "the flasher's next write is refused, because the flash ended their session",
  stale.status === 403 && errorOf(stale.body) === 'no_session',
  `status=${stale.status} body=${JSON.stringify(stale.body)}`,
);

// === 3. Rolling the firmware back reboots it again, and leaves the rollback behind. ===
await seedSessions();
const rollback = await writeManifest(withPackageVersion(BASE_MANIFEST, firmwareKey, baseFirmware));
const afterRollback = await readRows();
check(
  'a write rolling the firmware back is accepted',
  rollback.status === 200,
  `status=${rollback.status} body=${JSON.stringify(rollback.body)}`,
);
check(
  'and ends both sessions as a reboot',
  rebootedRows(afterRollback) === 2,
  `rows=${JSON.stringify(afterRollback.map((row) => [row.session_id, row.end_reason]))}`,
);
const secondBoot = await bootId();
check(
  'the boot id moves again',
  secondBoot !== null && secondBoot !== firstBoot,
  `before=${firstBoot} after=${secondBoot}`,
);
const dpkgRows = await journalRows(DPKG_LOG_PATH);
const rollbackLine = linesOf(dpkgRows).at(-1) ?? '';
check(
  "the rollback is in the gateway's dpkg.log, under the network's key",
  dpkgRows.length === 1 && dpkgRows[0]?.writer_key === apGatewayLogWriterKey(ESSID),
  `${dpkgRows.length} row(s) under ${dpkgRows[0]?.writer_key ?? '-'}`,
);
check(
  'naming the image, both versions in the order it moved, and the flasher’s address',
  rollbackLine.includes(
    `downgrade ${firmwareKey} ${newestFirmware} ${baseFirmware} Client "${FLASHER_LOGIN_IP}"`,
  ),
  rollbackLine.length === 0 ? '(no line)' : rollbackLine,
);
check(
  'and the second reboot joins the first in kern.log',
  linesOf(await journalRows(KERN_LOG_PATH)).length === 2,
  `${linesOf(await journalRows(KERN_LOG_PATH)).length} line(s)`,
);

await wipeWorld();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
