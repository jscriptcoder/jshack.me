// Wire-payload smoke for FINDIT.IO — a search answered by the REAL /api/network endpoint
// against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SEARCH IS A FETCH. `resolveHttpFetch` at findit's derived address with a `?q=`
//     path comes back as a ranked HTML page instead of a file, while every other path on
//     findit — and every other address — still reads a file.
//   - THE INDEX IS LIVE, AND BATCHED. The publishers' homepages are read through ONE
//     `.in('machine_id', ...)` query, so a title rewritten in a webserver's journal
//     changes that site's listing at the very next search, and a bricked webserver drops
//     out of the results entirely.
//   - THE BOX IS REAL. findit is reached, scanned and logged like any other public
//     address: a search lands in its own /var/log/access.log with the query string, under
//     the network's own key, naming the searcher at the address the server holds for them.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testFindit.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { crackableEssidPool } from '../src/core/generation/generateWifi';
import { siteAddress } from '../src/core/generation/publisher';
import { FINDIT_DOMAIN, FINDIT_NETWORK } from '../src/core/generation/findit';
import { siteServer } from '../src/core/generation/siteServer';
import { resolveLanHostIdentity } from '../src/core/generation/lanHostIdentity';
import { computeApGatewayId } from '../src/core/identity/router';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter';
import { ACCESS_LOG_PATH } from '../src/core/logging/accessLog';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs';
import { md5 } from '../src/core/generation/md5';

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

const CAMPUS = 'CAMPUS-GUEST-OPEN';
const CAMPUS_DOMAIN = 'ridgemont.edu';
const FINDIT_IP = siteAddress(FINDIT_DOMAIN);
const campusServer = siteServer(CAMPUS);
if (FINDIT_IP === undefined || campusServer === undefined) {
  console.error('findit or the campus publishes nothing — the world is unusable.');
  process.exit(2);
}
const campusServerId = resolveLanHostIdentity(campusServer, CAMPUS).machineId;
const finditMachineId = computeApGatewayId(FINDIT_NETWORK);

/** The searcher, standing on a network of their own so the trace has an address to name. */
const searcher = generateIdentity();
const searcherEssid = crackableEssidPool.find((essid) => essid !== CAMPUS)!;

const fetchPath = async (target: string, path: string) =>
  post(signRequest(searcher, 'resolveHttpFetch', { target, port: 80, path }));

const search = async (term: string) =>
  fetchPath(FINDIT_IP, `/?q=${encodeURIComponent(term)}`);

const seedPatch = async (machineId: string, path: string, content: string | null) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      // A deletion is a row whose content is null — the tombstone the replay treats as
      // `rm`. It is still a file row: what it names is a file that is now gone.
      node_type: 'file',
      writer_key: searcher.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`patch seed failed (${path}): ${error.message}`);
};

const clearPatch = async (machineId: string, path: string) => {
  const { error } = await sr.from('patches').delete().eq('machine_id', machineId).eq('path', path);
  if (error) throw new Error(`patch clear failed (${path}): ${error.message}`);
};

const logLines = async (): Promise<string> => {
  const { data, error } = await sr
    .from('patches')
    .select('writer_key, content')
    .eq('machine_id', finditMachineId)
    .eq('path', ACCESS_LOG_PATH);
  if (error) throw new Error(`log read failed: ${error.message}`);
  const rows = (data ?? []) as readonly { writer_key: string; content: string | null }[];
  const own = rows.filter((row) => row.writer_key === apGatewayLogWriterKey(FINDIT_NETWORK));
  return own.map((row) => row.content ?? '').join('\n');
};

/** The searcher's own network through the REAL endpoint, so the server allocates the
 *  address the trace has to name. */
const registerSearcherHome = async (): Promise<string | null> => {
  await post(
    signRequest(searcher, 'registerNetwork', {
      essid: searcherEssid,
      workstation_machine_id: computeWorkstationId('probe', searcher.publicKeyHex),
      workstation_username: 'probe',
      workstation_machine_name: 'probe',
      workstation_root_hash: md5('probe-root-secret'),
    }),
  );
  const { data } = await sr
    .from('network_public_ips')
    .select('public_ip')
    .eq('essid', searcherEssid)
    .maybeSingle();
  return (data as { public_ip: string } | null)?.public_ip ?? null;
};

const cleanup = async () => {
  await clearPatch(finditMachineId, ACCESS_LOG_PATH);
  await clearPatch(campusServerId, '/var/www/html/index.html');
  await clearPatch(campusServerId, '/boot/vmlinuz');
  await sr.from('home_network_occupants').delete().eq('owner_key', searcher.publicKeyHex);
};

const main = async () => {
  console.log(`findit.io answers at ${FINDIT_IP} (machine ${finditMachineId})`);
  console.log(`${CAMPUS_DOMAIN} is served from ${campusServer.hostname} (${campusServerId})\n`);

  await cleanup();
  const searcherHomeIp = await registerSearcherHome();
  if (searcherHomeIp === null) {
    console.error('Could not establish the searcher’s home network — nothing to name them by.');
    process.exit(2);
  }

  // 1. THE FRONT PAGE IS A FILE; A SEARCH IS NOT.
  const front = await fetchPath(FINDIT_IP, '/');
  check(
    'findit serves its own front page, with the form that documents it',
    front.status === 200 && contentOf(front.body).includes('<form action="/" method="GET">'),
    `status ${front.status}, ${contentOf(front.body).length} chars`,
  );

  // A word every kind of institution says of itself, so a thin index shows up as a thin
  // answer rather than passing for a good one.
  const broad = contentOf((await search('services')).body);
  check(
    'the web it searched is the whole public web, not one site',
    (broad.match(/<li>/g) ?? []).length > 1,
    `${(broad.match(/<li>/g) ?? []).length} result(s) for "services"`,
  );

  const ranked = await search('university');
  const rankedPage = contentOf(ranked.body);
  check(
    'a search ranks the university it names, linking its domain',
    ranked.status === 200 &&
      rankedPage.includes(`<a href="http://${CAMPUS_DOMAIN}/">Ridgemont University</a>`),
    `status ${ranked.status}, ${rankedPage.length} chars`,
  );
  const empty = await search('zzz-nothing-anywhere');
  check(
    'a search nothing answers says so, rather than inventing a result',
    contentOf(empty.body).includes('No matches for'),
    contentOf(empty.body).slice(0, 120),
  );

  // 2. THE INDEX IS LIVE.
  await seedPatch(
    campusServerId,
    '/var/www/html/index.html',
    '<html><head><title>OWNED BY R00T</title><meta name="description" content="Defaced."></head><body><p>Mine now.</p></body></html>',
  );
  const afterDeface = contentOf((await search('owned')).body);
  check(
    'a homepage rewritten in its journal is listed as it now reads',
    afterDeface.includes('OWNED BY R00T') && afterDeface.includes(`http://${CAMPUS_DOMAIN}/`),
    afterDeface.includes('OWNED BY R00T') ? 'listed under its new title' : 'still the old title',
  );
  const stale = contentOf((await search('admissions')).body);
  check(
    'and is no longer found by what it used to say',
    !stale.includes(`http://${CAMPUS_DOMAIN}/`),
    stale.includes(`http://${CAMPUS_DOMAIN}/`) ? 'still listed by its old words' : 'gone',
  );

  await clearPatch(campusServerId, '/var/www/html/index.html');
  await seedPatch(campusServerId, '/boot/vmlinuz', null);
  const afterBrick = contentOf((await search('university')).body);
  check(
    'a site whose webserver will not come up cannot be found at all',
    !afterBrick.includes(`http://${CAMPUS_DOMAIN}/`),
    afterBrick.includes(`http://${CAMPUS_DOMAIN}/`) ? 'still listed while bricked' : 'dark',
  );
  await clearPatch(campusServerId, '/boot/vmlinuz');

  // 3. AN ORDINARY SITE IGNORES A QUERY.
  const withQuery = await fetchPath(siteAddress(CAMPUS_DOMAIN)!, '/?q=university');
  check(
    'a query on an ordinary site is not a search — it serves the page',
    withQuery.status === 200 && contentOf(withQuery.body).includes('<title>'),
    `status ${withQuery.status}, ${contentOf(withQuery.body).length} chars`,
  );

  // 4. WHO SEARCHED FOR WHAT, IN FINDIT'S OWN LOG.
  const log = await logLines();
  check(
    'every search is written to findit’s own log, query string and all',
    log.includes('/?q=university') && log.includes(searcherHomeIp),
    log.split('\n').find((line) => line.includes('?q=')) ?? 'no line',
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
