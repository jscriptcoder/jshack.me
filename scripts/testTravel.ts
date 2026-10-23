// Wire-payload smoke for TRAVEL — boarding a ride at rideit.io moves a player to another
// town. Drives the REAL /api/network actions against a running `vercel dev` + supabase,
// then reads the tables a boarding touches.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - `GET /ticket` on rideit.io answers the booking form, and moves nobody.
//   - A boarding for a town the world does not declare is refused: the player keeps their
//     network and no location is written.
//   - A boarding for another town answers that the player arrived and left their network.
//     Their occupancy row is gone, a visitor's session on their box closed as the box
//     leaving, their own session on their own box stays open, and `player_locations` holds
//     the town with one trip.
//   - The join then refuses the town they started in and admits the one they travelled to,
//     and the scan's server call answers the new town.
//   - rideit's access log records `POST /board` from the network the traveller stood on,
//     and never the town.
//   - Two boardings at once store one move and count one trip: one arrives, the other says
//     the ticket was used, and both left.
//   - A boarding for the town the player already stands in is a trip like any other.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testTravel.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { md5 } from '../src/core/generation/md5.js';
import { DECLARED_NETWORKS, isLandmark, TOWNS } from '../src/core/generation/world.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { RIDEIT_DOMAIN, RIDEIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';
import { derivedPublicIpByEssid } from '../src/core/logging/crossPlayerSourceIp.js';

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

const post = async (envelope: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(NETWORK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

type Identity = ReturnType<typeof generateIdentity>;

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
const contentOf = (body: unknown): string => {
  const content = field(body, 'content');
  return typeof content === 'string' ? content : '';
};

// --- The world: the town the traveller starts in, two others, and a network in each. ---
const [START_TOWN, SECOND_TOWN, THIRD_TOWN] = TOWNS.map((town) => town.name);
const drawnIn = (town: string | undefined) =>
  DECLARED_NETWORKS.find((network) => network.town === town && !isLandmark(network.key));
const START_NETWORK = drawnIn(START_TOWN);
const SECOND_NETWORK = drawnIn(SECOND_TOWN);
if (
  START_TOWN === undefined ||
  SECOND_TOWN === undefined ||
  THIRD_TOWN === undefined ||
  START_NETWORK === undefined ||
  SECOND_NETWORK === undefined
) {
  console.error('The world declares too few towns, or a town with no network to join.');
  process.exit(2);
}

const RIDEIT_IP = siteAddress(RIDEIT_DOMAIN) ?? '';
const RIDEIT_MACHINE = computeApGatewayId(RIDEIT_NETWORK);

const traveller = generateIdentityIn(START_TOWN);
const visitor = generateIdentity();
const TRAVELLER_BOX = computeWorkstationId('travel-box', traveller.publicKeyHex);
const VISITOR_SESSION = 'ssh-travel-visitor-wirecheck';
const OWN_SESSION = 'ssh-travel-own-wirecheck';

const joinEnvelope = (identity: Identity, essid: string) =>
  signRequest(identity, 'registerNetwork', {
    essid,
    workstation_machine_id: TRAVELLER_BOX,
    workstation_username: 'player',
    workstation_machine_name: 'travel-box',
    workstation_root_hash: md5('root-secret'),
  });

const rideit = (path: string, body?: string) =>
  post(
    signRequest(traveller, 'resolveHttpFetch', {
      target: RIDEIT_IP,
      port: 80,
      path,
      ...(body === undefined ? {} : { body }),
    }),
  );
const boardFor = (town: string) => rideit('/board', new URLSearchParams({ town }).toString());

const occupanciesOf = async (ownerKey: string): Promise<readonly string[]> => {
  const { data, error } = await sr
    .from('home_network_occupants')
    .select('essid')
    .eq('owner_key', ownerKey);
  if (error) throw new Error(`occupancy read failed: ${error.message}`);
  return ((data ?? []) as readonly { essid: string }[]).map((row) => row.essid);
};

const locationOf = async (ownerKey: string) => {
  const { data, error } = await sr
    .from('player_locations')
    .select('town, trips')
    .eq('owner_key', ownerKey)
    .maybeSingle();
  if (error) throw new Error(`location read failed: ${error.message}`);
  return data as { town: string; trips: number } | null;
};

const endReasonOf = async (sessionId: string): Promise<string | null> => {
  const { data, error } = await sr
    .from('sessions')
    .select('ended_at, end_reason')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`session read failed: ${error.message}`);
  const row = data as { ended_at: string | null; end_reason: string | null } | null;
  return row?.ended_at === null || row === null ? null : (row.end_reason ?? 'ended');
};

/** rideit's access log as its gateway's recorder wrote it. */
const rideitLog = async (): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', RIDEIT_MACHINE)
    .eq('path', ACCESS_LOG_PATH);
  if (error) throw new Error(`log read failed: ${error.message}`);
  return ((data ?? []) as readonly { writer_key: string; content: string | null }[])
    .filter((row) => row.writer_key === apGatewayLogWriterKey(RIDEIT_NETWORK))
    .map((row) => row.content ?? '')
    .join('\n');
};

const cleanup = async () => {
  await sr.from('player_locations').delete().eq('owner_key', traveller.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', traveller.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', traveller.publicKeyHex);
  await sr.from('sessions').delete().in('session_id', [VISITOR_SESSION, OWN_SESSION]);
};
await cleanup();

// === 0. The traveller stands at home in the town they started in, with company. ===
const joinedHome = await post(joinEnvelope(traveller, START_NETWORK.key));
check(
  `the traveller joins ${START_NETWORK.key} in ${START_TOWN}, the town they start in`,
  joinedHome.status === 200,
  `status=${joinedHome.status} error=${String(field(joinedHome.body, 'error'))}`,
);
const seeded = await sr.from('sessions').insert([
  {
    session_id: VISITOR_SESSION,
    player_key: visitor.publicKeyHex,
    machine_id: TRAVELLER_BOX,
    credentials: { username: 'guest', userType: 'guest' },
    kind: 'ssh',
    essid: START_NETWORK.key,
  },
  {
    session_id: OWN_SESSION,
    player_key: traveller.publicKeyHex,
    machine_id: TRAVELLER_BOX,
    credentials: { username: 'root', userType: 'root' },
    kind: 'su',
    essid: START_NETWORK.key,
  },
]);
if (seeded.error) throw new Error(`session seed failed: ${seeded.error.message}`);

// === 1. The ticket page sells tickets and moves nobody. ===
const ticket = await rideit('/ticket');
check(
  'GET /ticket answers the booking form, one Board button per town',
  ticket.status === 200 &&
    (contentOf(ticket.body).match(/value="Board"/g) ?? []).length === TOWNS.length &&
    field(ticket.body, 'left') === undefined,
  `status=${ticket.status} buttons=${(contentOf(ticket.body).match(/value="Board"/g) ?? []).length}`,
);

// === 2. A town the world does not declare is refused, and changes nothing. ===
const nowhere = await boardFor('Atlantis');
check(
  'a boarding for Atlantis is refused, and says the player stayed',
  nowhere.status === 200 &&
    contentOf(nowhere.body).includes('We do not go there.') &&
    field(nowhere.body, 'left') === false,
  `status=${nowhere.status} left=${String(field(nowhere.body, 'left'))}`,
);
const afterNowhere = await occupanciesOf(traveller.publicKeyHex);
const locationAfterNowhere = await locationOf(traveller.publicKeyHex);
check(
  'the refused boarding leaves the traveller on their network, with no location written',
  afterNowhere.length === 1 && afterNowhere[0] === START_NETWORK.key && locationAfterNowhere === null,
  `occupancies=${afterNowhere.join(',')} location=${JSON.stringify(locationAfterNowhere)}`,
);

// === 3. Boarding for another town moves the traveller there, and is leaving. ===
const boarded = await boardFor(SECOND_TOWN);
check(
  `a boarding for ${SECOND_TOWN} answers that the traveller arrived, and left`,
  boarded.status === 200 &&
    contentOf(boarded.body).includes(`You have arrived in ${SECOND_TOWN}.`) &&
    field(boarded.body, 'left') === true,
  `status=${boarded.status} left=${String(field(boarded.body, 'left'))} error=${String(field(boarded.body, 'error'))}`,
);
const afterBoarding = await occupanciesOf(traveller.publicKeyHex);
check(
  'the traveller is on no network any more',
  afterBoarding.length === 0,
  `occupancies=${afterBoarding.join(',')}`,
);
const visitorReason = await endReasonOf(VISITOR_SESSION);
const ownReason = await endReasonOf(OWN_SESSION);
check(
  "the visitor's session on the traveller's box closed as the box leaving",
  visitorReason === 'network_left',
  `reason=${visitorReason}`,
);
check(
  "the traveller's own session on their own box stays open",
  ownReason === null,
  `reason=${ownReason}`,
);
const firstLocation = await locationOf(traveller.publicKeyHex);
check(
  `player_locations holds ${SECOND_TOWN} with one trip`,
  firstLocation?.town === SECOND_TOWN && firstLocation.trips === 1,
  `location=${JSON.stringify(firstLocation)}`,
);

// === 4. The traveller joins and scans where they now stand. ===
const refusedHome = await post(joinEnvelope(traveller, START_NETWORK.key));
check(
  `a join to ${START_NETWORK.key} in ${START_TOWN}, the town they started in, is refused`,
  refusedHome.status === 403 && field(refusedHome.body, 'error') === 'network_not_joinable',
  `status=${refusedHome.status} error=${String(field(refusedHome.body, 'error'))}`,
);
const joinedThere = await post(joinEnvelope(traveller, SECOND_NETWORK.key));
check(
  `a join to ${SECOND_NETWORK.key} in ${SECOND_TOWN} is admitted`,
  joinedThere.status === 200,
  `status=${joinedThere.status} error=${String(field(joinedThere.body, 'error'))}`,
);
const scanned = await post(signRequest(traveller, 'resolveOccupiedEssids', {}));
check(
  `the scan's server call answers ${SECOND_TOWN}`,
  scanned.status === 200 && field(scanned.body, 'town') === SECOND_TOWN,
  `status=${scanned.status} town=${String(field(scanned.body, 'town'))}`,
);
const stranger = await post(signRequest(visitor, 'resolveOccupiedEssids', {}));
check(
  'a player who never travelled is answered the town their key draws',
  stranger.status === 200 && typeof field(stranger.body, 'town') === 'string',
  `status=${stranger.status} town=${String(field(stranger.body, 'town'))}`,
);

// === 5. rideit's log names who boarded and from where, never where to. ===
const log = await rideitLog();
const homeIp = (await derivedPublicIpByEssid(START_NETWORK.key)).data?.public_ip;
const boardLines = log.split('\n').filter((line) => line.includes('"POST /board'));
check(
  "rideit's access log records POST /board from the network the traveller stood on",
  homeIp !== undefined && boardLines.some((line) => line.startsWith(`${homeIp} `)),
  `homeIp=${homeIp} lines=${JSON.stringify(boardLines.slice(-2))}`,
);
check(
  "rideit's access log never names a town",
  !TOWNS.some((town) => log.includes(town.name)) && !log.includes('Atlantis'),
  `tail=${JSON.stringify(log.split('\n').slice(-3))}`,
);

// === 6. Two boardings at once store one move and count one trip. ===
const doubled = await Promise.all([boardFor(THIRD_TOWN), boardFor(THIRD_TOWN)]);
const doubledPages = doubled.map((answer) => contentOf(answer.body));
const doubledLocation = await locationOf(traveller.publicKeyHex);
check(
  'two boardings at once both answer, and both left',
  doubled.every((answer) => answer.status === 200 && field(answer.body, 'left') === true),
  `statuses=${doubled.map((answer) => answer.status).join(',')}`,
);
check(
  'one arrives and the other says the ticket was used',
  doubledPages.filter((page) => page.includes(`You have arrived in ${THIRD_TOWN}.`)).length === 1 &&
    doubledPages.filter((page) => page.includes('This ticket has already been used.')).length === 1,
  `pages=${JSON.stringify(doubledPages.map((page) => page.match(/<p>[^<]*<\/p>/)?.[0]))}`,
);
check(
  `the two count one trip: ${THIRD_TOWN} with two trips`,
  doubledLocation?.town === THIRD_TOWN && doubledLocation.trips === 2,
  `location=${JSON.stringify(doubledLocation)}`,
);

// === 7. A boarding for the town the player stands in is a trip like any other. ===
const stay = await boardFor(THIRD_TOWN);
const stayLocation = await locationOf(traveller.publicKeyHex);
check(
  `a boarding for ${THIRD_TOWN}, where they stand, arrives, leaves and counts a trip`,
  stay.status === 200 &&
    field(stay.body, 'left') === true &&
    stayLocation?.town === THIRD_TOWN &&
    stayLocation.trips === 3,
  `status=${stay.status} location=${JSON.stringify(stayLocation)}`,
);

await cleanup();

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
