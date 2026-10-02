// Wire-payload smoke for EVERY TOWN THE WORLD DRAWS — each reachable over the internet
// alone, and none joinable. Drives the REAL /api/network endpoint against a running
// `vercel dev` + supabase, once for each town beyond Ridgemont.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - Each town's council, and the courthouse of a town that keeps one, answers a fetch
//     by its domain with its own front page, at an address in its town's own block of the
//     region.
//   - findit's live index finds a place of each town by the town's name and a word its
//     kind of place says of itself, which is how a player finds a shop in a town whose
//     name they know.
//   - A join to each town's council is refused with 403 network_not_joinable, and leaves
//     no LAN lease and no occupant row behind.
//
// `whois` is not here: it asks nobody on the network, answering from the world's
// declaration, so its unit tests are the whole of its evidence.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testTowns.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { md5 } from '../src/core/generation/md5.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { siteServer } from '../src/core/generation/siteServer.js';
import { FINDIT_DOMAIN } from '../src/core/generation/findit.js';
import { DECLARED_NETWORKS, RIDGEMONT } from '../src/core/generation/world.js';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog.js';

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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

/** A word each kind of shop, café, office or practice says of itself in its description. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  grocer: 'groceries',
  bakery: 'pastries',
  pharmacy: 'prescriptions',
  bookshop: 'books',
  electronics: 'cables',
  hardware: 'screws',
  pawn: 'jewellery',
  florist: 'wreaths',
  cafe: 'light lunches',
  'tea-room': 'scones',
  'coffee-bar': 'cold brew',
  consulting: 'audits',
  logistics: 'freight',
  insurance: 'insurance',
  'it-services': 'managed IT',
  accounting: 'payroll',
  clinic: 'vaccinations',
  dentist: 'fillings',
};

const TOWNS = [
  ...new Set(
    DECLARED_NETWORKS.flatMap((network) =>
      network.town === undefined || network.town === RIDGEMONT ? [] : [network.town],
    ),
  ),
];
const FINDIT_IP = siteAddress(FINDIT_DOMAIN);
if (TOWNS.length < 2 || FINDIT_IP === undefined) {
  console.error('The world draws fewer than two towns, or findit is not on the internet.');
  process.exit(2);
}

const visitor = generateIdentity();
const player = generateIdentity();

const joinEnvelope = (essid: string) =>
  signRequest(player, 'registerNetwork', {
    essid,
    workstation_machine_id: computeWorkstationId('towns-box', player.publicKeyHex),
    workstation_username: 'player',
    workstation_machine_name: 'towns-box',
    workstation_root_hash: md5('root-secret'),
  });

/** Every row a join can leave behind for one network. */
const rowsFor = async (essid: string): Promise<number> => {
  const count = async (table: string) => {
    const { count: rows } = await sr
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('essid', essid);
    return rows ?? 0;
  };
  return (await count('network_lan_leases')) + (await count('home_network_occupants'));
};

for (const town of TOWNS) {
  const council = DECLARED_NETWORKS.find(
    (network) => network.town === town && network.directory !== undefined,
  );
  const councilSite = council?.site;
  const councilIp = councilSite === undefined ? undefined : siteAddress(councilSite.domain);
  const server = council === undefined ? undefined : siteServer(council.key);
  const place = DECLARED_NETWORKS.find(
    (network) =>
      network.town === town &&
      network.site !== undefined &&
      network.unlisted !== true &&
      KIND_WORDS[network.subtype ?? ''] !== undefined,
  );
  if (
    council === undefined ||
    councilSite === undefined ||
    councilIp === undefined ||
    server === undefined ||
    place?.site === undefined
  ) {
    console.error(`${town} has no council or no listed place on the internet.`);
    process.exit(2);
  }
  // A town bigger than a village keeps a courthouse, fetched by its domain as the council is.
  const courthouse = DECLARED_NETWORKS.find(
    (network) => network.town === town && network.place === 'the courthouse',
  );
  const fetchedNetworks = [council, ...(courthouse === undefined ? [] : [courthouse])];
  const machines = fetchedNetworks.flatMap((network) => {
    const siteBox = siteServer(network.key);
    return [
      computeApGatewayId(network.key),
      ...(siteBox === undefined ? [] : [machineIdForLanHost(siteBox, network.key)]),
    ];
  });
  const cleanup = async () => {
    await sr.from('patches').delete().in('machine_id', machines).eq('path', ACCESS_LOG_PATH);
    await sr.from('home_network_occupants').delete().eq('essid', council.key);
    await sr.from('network_lan_leases').delete().eq('essid', council.key);
  };
  await cleanup();

  // === 1. The council, and any courthouse, answer by their domains, in the town's block. ===
  const sameBlock = DECLARED_NETWORKS.filter((network) => network.town === town).every(
    (network) =>
      network.site === undefined ||
      siteAddress(network.site.domain)?.split('.').slice(0, 2).join('.') ===
        councilIp.split('.').slice(0, 2).join('.'),
  );
  for (const network of fetchedNetworks) {
    const site = network.site;
    const address = site === undefined ? undefined : siteAddress(site.domain);
    if (site === undefined || address === undefined) {
      console.error(`${network.key} publishes no site on the internet.`);
      process.exit(2);
    }
    const fetched = await post(
      signRequest(visitor, 'resolveHttpFetch', { target: address, port: 80, path: '/' }),
    );
    check(
      `curl http://${site.domain}/ returns ${site.name}'s own front page`,
      fetched.status === 200 &&
        contentOf(fetched.body).includes(`<title>${site.name}</title>`) &&
        /^87\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address) &&
        sameBlock,
      `address=${address} status=${fetched.status} error=${errorOf(fetched.body)}`,
    );
  }

  // === 2. findit finds one of the town's places by the town's name and its kind. ===
  const query = `${town} ${KIND_WORDS[place.subtype ?? '']}`;
  const searched = await post(
    signRequest(visitor, 'resolveHttpFetch', {
      target: FINDIT_IP,
      port: 80,
      path: `/?q=${encodeURIComponent(query)}`,
    }),
  );
  check(
    `a findit search for "${query}" lists ${place.site.domain}`,
    searched.status === 200 &&
      contentOf(searched.body).includes(`<a href="http://${place.site.domain}/">`),
    `status=${searched.status} error=${errorOf(searched.body)}`,
  );

  // === 3. A join to the council is refused, and writes nothing. ===
  const refused = await post(joinEnvelope(council.key));
  const leftBehind = await rowsFor(council.key);
  check(
    `a join to ${council.key} (${town}'s town hall) is refused with 403 network_not_joinable`,
    refused.status === 403 && errorOf(refused.body) === 'network_not_joinable' && leftBehind === 0,
    `status=${refused.status} error=${errorOf(refused.body)} rows=${leftBehind}`,
  );

  await cleanup();
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
