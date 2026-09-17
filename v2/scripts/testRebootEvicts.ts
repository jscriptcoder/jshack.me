// Wire-payload check for the eviction action — `rebootMachine`. Drives the REAL
// /api/sessions endpoint against a running `vercel dev` + supabase, seeding session
// rows via service_role (as the doors would), then asserting the net-new (locally
// untypechecked api/) runtime:
//   - TWO IDENTITIES, which is the only way to prove the thing this action exists for:
//     a reboot closes rows belonging to a player the rebooter has never met, and a
//     player holding root on a box can throw its OWNER off it. Neither claim can be
//     made by a handler test, where the other player is a fixture.
//   - Every active row on that machine dies, across every kind — including one no hop
//     chain on any screen was standing on. That is the whole difference from
//     endSession, and it cannot be proven without a real UPDATE.
//   - The authority is checked BEFORE anything moves: a caller with no session on the
//     box, and one standing on it below root, are both refused and leave every row
//     open. A machine id is not a capability.
//   - The rows come back stamped `rebooted`, not `user_exit`: the record of a player
//     being thrown off must not read like one of them walking away.
//   - A row the same player holds on ANOTHER machine survives. The box went down; the
//     rest of the world did not.
//   - The client popping its hop chain AFTER the reboot cannot rewrite `rebooted` into
//     `user_exit`. Those exits really are sent, milliseconds later, so the update has
//     to refuse an already-closed row.
//   - endSession refuses a caller who NAMES `rebooted`: a box going down is something
//     the server witnessed, not something a caller may claim.
//   - The box comes back carrying a FRESH boot id at the allowlisted marker path, with
//     the permissions an unauthenticated reader needs to see it at all — the half no
//     unit test can prove, because the row that carries it is written by api/ glue and
//     read back through the same journal every client materializes the box from. A
//     second reboot must move it again, or a box could only ever evict a shell once.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testRebootEvicts.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { computeApGatewayId } from '../src/core/identity/router';
import { BOOT_ID_PATH } from '../src/core/boot/bootId';
import type { UserType } from '../src/core/types';

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

// Three players on one box. The defender owns it; the intruder got root on it; the
// lurker only ever got a limited shell. The stranger has never been near it.
const defender = generateIdentity();
const intruder = generateIdentity();
const lurker = generateIdentity();
const stranger = generateIdentity();

// The defender's OWN workstation, by the same suffix derivation the server matches
// on — so the owner arm authorizes without any row to read a tier from. That is not
// a convenience here: after the first reboot the box has no open rows at all, and a
// second one still has to work.
const OWN_BOX = computeWorkstationId('wirebox', defender.publicKeyHex);
// Nobody owns an access point, so only the root-session arm can ever reboot one.
const GATEWAY = computeApGatewayId('WIRE-AP-9F2A');
const ELSEWHERE = 'reboot-wire-other-box';

const DEFENDER_SHELL = 'reboot-wire-defender-shell';
const DEFENDER_UNNAMED = 'reboot-wire-defender-unnamed';
const INTRUDER_ROOT = 'reboot-wire-intruder';
const LURKER_LIMITED = 'reboot-wire-lurker';
const OFF_BOX = 'reboot-wire-elsewhere';
const GATEWAY_INTRUDER = 'reboot-wire-gw-intruder';
const GATEWAY_DEFENDER = 'reboot-wire-gw-defender';

const ON_OWN_BOX = [DEFENDER_SHELL, DEFENDER_UNNAMED, INTRUDER_ROOT, LURKER_LIMITED];
const ALL_IDS = [...ON_OWN_BOX, OFF_BOX, GATEWAY_INTRUDER, GATEWAY_DEFENDER];

const sessionRow = (
  sessionId: string,
  owner: ReturnType<typeof generateIdentity>,
  machineId: string,
  kind: string,
  username: string,
  userType: UserType,
) => ({
  session_id: sessionId,
  player_key: owner.publicKeyHex,
  machine_id: machineId,
  credentials: { username, userType },
  parent_session_id: null,
  source_ip: null,
  kind,
});

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

const rowFor = (rows: readonly Row[], sessionId: string): Row | undefined =>
  rows.find((row) => row.session_id === sessionId);

const allOpen = (rows: readonly Row[], ids: readonly string[]): boolean =>
  ids.every((id) => rowFor(rows, id)?.ended_at === null);

const closed = (rows: readonly Row[], sessionId: string): boolean => {
  const ended = rowFor(rows, sessionId)?.ended_at;
  return typeof ended === 'string' && ended.length > 0;
};

// Clean slate, then seed. The defender's second shell is load-bearing: it sits on
// the rebooted box with NO hop chain naming it, which is what a session-id-scoped
// eviction would leave behind.
await sr.from('sessions').delete().in('session_id', ALL_IDS);
await sr
  .from('sessions')
  .insert([
    sessionRow(DEFENDER_SHELL, defender, OWN_BOX, 'su', 'root', 'root'),
    sessionRow(DEFENDER_UNNAMED, defender, OWN_BOX, 'su', 'root', 'root'),
    sessionRow(INTRUDER_ROOT, intruder, OWN_BOX, 'exploit', 'root', 'root'),
    sessionRow(LURKER_LIMITED, lurker, OWN_BOX, 'exploit_limited', 'www-data', 'user'),
    sessionRow(OFF_BOX, defender, ELSEWHERE, 'ssh', 'neo', 'user'),
    sessionRow(GATEWAY_INTRUDER, intruder, GATEWAY, 'ssh', 'root', 'root'),
    sessionRow(GATEWAY_DEFENDER, defender, GATEWAY, 'ssh', 'admin', 'user'),
  ]);

// === 1. The authority is checked before anything moves. ===
const byStranger = await post(signRequest(stranger, 'rebootMachine', { machine_id: OWN_BOX }));
check(
  'a caller holding no session on the box is refused',
  byStranger.status === 403,
  `status=${byStranger.status} body=${JSON.stringify(byStranger.body)}`,
);

const byLurker = await post(signRequest(lurker, 'rebootMachine', { machine_id: OWN_BOX }));
check(
  'a caller standing on the box below root is refused',
  byLurker.status === 403,
  `status=${byLurker.status} body=${JSON.stringify(byLurker.body)}`,
);

const afterRefusals = await readRows();
check(
  'neither refusal closed a single row',
  allOpen(afterRefusals, ON_OWN_BOX),
  `open=${ON_OWN_BOX.filter((id) => rowFor(afterRefusals, id)?.ended_at === null).length}/${ON_OWN_BOX.length}`,
);
// A refused reboot must not leave a marker either: the marker is what evicts every
// live shell on the box, so writing one would carry out the eviction the 403 refused.
const { data: refusedMarker } = await sr
  .from('patches')
  .select('content')
  .eq('machine_id', OWN_BOX)
  .eq('path', BOOT_ID_PATH)
  .maybeSingle();
check(
  'a refused reboot leaves no boot id behind',
  refusedMarker === null,
  `marker=${JSON.stringify(refusedMarker)}`,
);

// === 2. The owner reboots, and the box takes everybody down with it. ===
const rebooted = await post(signRequest(defender, 'rebootMachine', { machine_id: OWN_BOX }));
check(
  'a signed reboot by the box owner is accepted',
  rebooted.status === 200,
  `status=${rebooted.status}`,
);

const afterReboot = await readRows();
check(
  'the shell the owner was standing on is closed',
  closed(afterReboot, DEFENDER_SHELL),
  `ended_at=${rowFor(afterReboot, DEFENDER_SHELL)?.ended_at}`,
);
check(
  'a second session on the same box is closed too, though no hop chain named it',
  closed(afterReboot, DEFENDER_UNNAMED),
  `ended_at=${rowFor(afterReboot, DEFENDER_UNNAMED)?.ended_at}`,
);
// The headline. Neither of these players has met the rebooter, and neither kind is
// named anywhere in the action — the machine is.
check(
  "an intruder's rooted shell on the box is closed by its owner",
  closed(afterReboot, INTRUDER_ROOT),
  `ended_at=${rowFor(afterReboot, INTRUDER_ROOT)?.ended_at}`,
);
check(
  "a third player's limited shell goes with it, so no kind is exempt",
  closed(afterReboot, LURKER_LIMITED),
  `ended_at=${rowFor(afterReboot, LURKER_LIMITED)?.ended_at}`,
);

// === 3. Closed as an eviction, not as an exit. ===
check(
  'every closed row records that the box went down, not that the player left',
  ON_OWN_BOX.every((id) => rowFor(afterReboot, id)?.end_reason === 'rebooted'),
  `reasons=${ON_OWN_BOX.map((id) => rowFor(afterReboot, id)?.end_reason).join(',')}`,
);

// === 4. The blast radius stops at the machine. ===
check(
  'a session on another machine survives the reboot',
  rowFor(afterReboot, OFF_BOX)?.ended_at === null,
  `ended_at=${rowFor(afterReboot, OFF_BOX)?.ended_at}`,
);
check(
  'sessions on the access point survive a workstation reboot',
  allOpen(afterReboot, [GATEWAY_INTRUDER, GATEWAY_DEFENDER]),
  `gateway rows open=${[GATEWAY_INTRUDER, GATEWAY_DEFENDER].filter((id) => rowFor(afterReboot, id)?.ended_at === null).length}/2`,
);

// === 5. The hop-chain pops that follow cannot rewrite why the rows closed. ===
const evictedAt = rowFor(afterReboot, DEFENDER_UNNAMED)?.ended_at;
const lateExit = await post(signRequest(defender, 'endSession', { session_id: DEFENDER_UNNAMED }));
const afterLateExit = await readRows();
const stillEvicted = rowFor(afterLateExit, DEFENDER_UNNAMED);
check(
  'a late exit for an already-closed row is accepted without rewriting it',
  lateExit.status === 200 && stillEvicted?.end_reason === 'rebooted',
  `status=${lateExit.status} reason=${stillEvicted?.end_reason}`,
);
check(
  'the eviction timestamp is left alone by that late exit',
  stillEvicted?.ended_at === evictedAt,
  `before=${evictedAt} after=${stillEvicted?.ended_at}`,
);

// === 6. A caller cannot claim an eviction of their own. ===
const claimed = await post(
  signRequest(defender, 'endSession', { session_id: OFF_BOX, reason: 'rebooted' }),
);
const afterClaim = await readRows();
check(
  'endSession refuses a caller naming `rebooted` as the reason',
  claimed.status === 400,
  `status=${claimed.status}`,
);
check(
  'the refused claim left the row untouched',
  rowFor(afterClaim, OFF_BOX)?.ended_at === null,
  `ended_at=${rowFor(afterClaim, OFF_BOX)?.ended_at}`,
);

// === 7. The box comes back carrying a marker a shell on it can read. ===
const readMarker = async (machineId: string) => {
  const { data } = await sr
    .from('patches')
    .select('content, owner, permissions')
    .eq('machine_id', machineId)
    .eq('path', BOOT_ID_PATH)
    .maybeSingle();
  return data as { content: string; owner: string; permissions: { read: string[] } } | null;
};

const marker = await readMarker(OWN_BOX);
check(
  'the reboot left a boot id on the box',
  typeof marker?.content === 'string' && marker.content.trim().length > 0,
  `content=${JSON.stringify(marker?.content)}`,
);
// Root-owned and world-readable, because the reader who most needs it holds no
// session at all: their rows were just closed, so the tree they pull next is the
// tier-3 allowlist, and a marker they cannot read is a box that never rebooted.
check(
  'the marker is readable by a caller holding no session on the box',
  marker?.owner === 'root' && marker?.permissions.read.includes('guest') === true,
  `owner=${marker?.owner} read=${JSON.stringify(marker?.permissions.read)}`,
);

// === 8. A second reboot moves it, so a box can evict more than once. ===
// It also proves the owner arm needs no row: by now every session on this box is
// closed, so an authority read off the session table would refuse its own owner.
const secondReboot = await post(signRequest(defender, 'rebootMachine', { machine_id: OWN_BOX }));
const movedMarker = await readMarker(OWN_BOX);
check(
  'a second reboot mints a different id, with every row on the box already closed',
  secondReboot.status === 200 &&
    typeof movedMarker?.content === 'string' &&
    movedMarker.content !== marker?.content,
  `status=${secondReboot.status} before=${marker?.content?.trim()} after=${movedMarker?.content?.trim()}`,
);

// === 9. The other authority: root on a box that is not yours, and that nobody owns. ===
const gatewayReboot = await post(signRequest(intruder, 'rebootMachine', { machine_id: GATEWAY }));
check(
  'a rooted session reboots an access point gateway nobody owns',
  gatewayReboot.status === 200,
  `status=${gatewayReboot.status} body=${JSON.stringify(gatewayReboot.body)}`,
);

const afterGateway = await readRows();
check(
  "the rebooter's own session on the gateway is closed",
  closed(afterGateway, GATEWAY_INTRUDER),
  `ended_at=${rowFor(afterGateway, GATEWAY_INTRUDER)?.ended_at}`,
);
// The symmetric half of the headline: a player who is not the owner, authorized by a
// root session alone, closes a row belonging to somebody else entirely.
check(
  "another player's session on the gateway is closed by someone who does not own it",
  closed(afterGateway, GATEWAY_DEFENDER),
  `ended_at=${rowFor(afterGateway, GATEWAY_DEFENDER)?.ended_at}`,
);
const gatewayMarker = await readMarker(GATEWAY);
check(
  'the gateway comes back carrying its own boot id',
  typeof gatewayMarker?.content === 'string' && gatewayMarker.content.trim().length > 0,
  `content=${JSON.stringify(gatewayMarker?.content)}`,
);

// Cleanup.
await sr.from('sessions').delete().in('session_id', ALL_IDS);
await sr.from('patches').delete().in('machine_id', [OWN_BOX, GATEWAY]).eq('path', BOOT_ID_PATH);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
