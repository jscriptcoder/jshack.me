// Wire-payload smoke for HACKADEMY.IO — the tutorial site answered by the REAL /api/network
// and /api/sessions endpoints against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SITE IS AT ITS ADDRESS. `resolveHttpFetch` at hackademy's derived address serves
//     the generated front page, and the chapter it links to, byte for byte.
//   - THE VISIT IS LOGGED. Each fetch lands in hackademy's own /var/log/access.log, under
//     the network's own key, naming the visitor at the address the server holds for them.
//   - THE BOX IS REAL. A scan of its address finds the two doors it keeps, 22 and 80, and
//     a login with a wrong password is refused and recorded in its auth.log.
//   - FINDIT LISTS IT. A search for the site's name, and for a word a newcomer would type,
//     answers with hackademy.io — both before anybody has visited it and after its own log
//     has rows — and the result a reader follows leads to the front page.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testHackademy.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { FINDIT_DOMAIN } from '../src/core/generation/fixedSites.js';
import { buildFixedSiteFs } from '../src/core/generation/fixedSiteFs.js';
import { fixedSite, HACKADEMY_NETWORK } from '../src/core/generation/fixedSites.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { createFsView } from '../src/core/filesystem/fsView.js';
import { md5 } from '../src/core/generation/md5.js';
import { asAbsPath } from '../src/core/types.js';
import { publicAddressOf } from './publicAddressOf.js';

const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const site = fixedSite(HACKADEMY_NETWORK);
const SITE_IP = siteAddress('hackademy.io');
if (site === undefined || SITE_IP === undefined) {
  console.error('hackademy.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(site.key);
const logKey = apGatewayLogWriterKey(site.key);

/** What the site was generated to serve at `path` under its document root. */
const generated = (path: string): string => {
  const read = createFsView(buildFixedSiteFs(site), { userType: 'root' }).read(
    asAbsPath(`/var/www/html${path}`),
  );
  return read.ok ? read.content : '';
};

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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

const portsOf = (body: unknown): readonly number[] =>
  ((body as { ports?: readonly { port: number }[] } | null)?.ports ?? []).map(({ port }) => port);

/** A log on the site, as the system writes it: under the network's own key. */
const siteLog = async (path: string): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', path)
    .eq('writer_key', logKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

/** The address of the first result on a findit results page, as a reader would follow it. */
const firstResultHost = (resultsPage: string): string =>
  /<li>\s*<h2><a href="http:\/\/([^/"]+)\//.exec(resultsPage)?.[1] ?? '';

const visitor = generateIdentity();
const [visitorEssid] = crackableEssidPool;

const cleanup = async () => {
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId);
};

const main = async () => {
  console.log(`hackademy.io answers at ${SITE_IP} (machine ${machineId})`);
  await cleanup();

  const joined = await post(
    NETWORK,
    signRequest(visitor, 'registerNetwork', {
      essid: visitorEssid,
      workstation_machine_id: computeWorkstationId('newbie', visitor.publicKeyHex),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  if (joined.status !== 200 || visitorEssid === undefined) {
    console.error(`Could not put the visitor on a network: status ${joined.status}`);
    process.exit(2);
  }
  const visitorIp = publicAddressOf(visitorEssid);
  console.log(`Visitor on ${visitorEssid} at ${visitorIp}\n`);

  const fetchFrom = (target: string, path: string) =>
    post(NETWORK, signRequest(visitor, 'resolveHttpFetch', { target, port: 80, path }));
  const fetchPath = (path: string) => fetchFrom(SITE_IP, path);
  const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';
  const searchFor = async (term: string): Promise<string> =>
    contentOf((await fetchFrom(FINDIT_IP, `/?q=${encodeURIComponent(term)}`)).body);

  // 0. FINDIT LISTS IT BEFORE ANYBODY HAS VISITED.
  const untouched = firstResultHost(await searchFor('hackademy'));
  check(
    'a search for its name answers with hackademy.io first while nobody has visited it',
    untouched === 'hackademy.io',
    untouched || '(no result)',
  );

  // 1. THE FRONT PAGE, AND THE CHAPTER IT LINKS TO.
  const front = await fetchPath('/');
  check(
    'the front page is the one hackademy was generated with',
    front.status === 200 && contentOf(front.body) === generated('/index.html'),
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  check(
    'the front page links to chapter 1',
    contentOf(front.body).includes('href="/getting-around.html"'),
    'href="/getting-around.html"',
  );
  const chapter = await fetchPath('/getting-around.html');
  check(
    'chapter 1 is served as generated',
    chapter.status === 200 && contentOf(chapter.body) === generated('/getting-around.html'),
    contentOf(chapter.body).slice(0, 80) || `status ${chapter.status}`,
  );

  // 2. THE VISIT IS LOGGED ON THE SITE ITSELF.
  const accessLog = await siteLog('/var/log/access.log');
  const visit = accessLog.split('\n').find((line) => line.includes('GET /getting-around.html')) ?? '';
  check(
    'the visit lands in hackademy’s access.log, under the visitor’s address',
    visit.includes(visitorIp),
    visit || `no chapter line in ${accessLog.length} chars of log`,
  );

  // 3. A SCAN FINDS ITS TWO DOORS.
  const scan = await post(NETWORK, signRequest(visitor, 'resolvePublicScan', { target: SITE_IP }));
  const ports = [...portsOf(scan.body)].sort((left, right) => left - right);
  check(
    'a scan of its address finds 22 and 80 and nothing else',
    scan.status === 200 && JSON.stringify(ports) === JSON.stringify([22, 80]),
    `status ${scan.status}, ports ${JSON.stringify(ports)}`,
  );

  // 4. A WRONG PASSWORD IS REFUSED, AND RECORDED.
  const login = await post(
    SESSIONS,
    signRequest(visitor, 'authCreateSessionPublic', {
      session_id: `ssh-hackademy-${Date.now()}`,
      target: SITE_IP,
      username: 'root',
      password: 'not-the-password',
    }),
  );
  const authLog = await siteLog('/var/log/auth.log');
  check(
    'a wrong root password is refused and recorded in its auth.log',
    login.status === 401 && authLog.includes(`Failed password for root from ${visitorIp}`),
    `status ${login.status}; ${authLog.trim().split('\n').slice(-1)[0] ?? '(empty log)'}`,
  );

  // 5. FINDIT STILL LISTS IT ONCE ITS OWN LOG HAS ROWS, AND THE RESULT LEADS HOME.
  const named = firstResultHost(await searchFor('hackademy'));
  const followed = siteAddress(named);
  const landing = followed === undefined ? null : await fetchFrom(followed, '/');
  check(
    'a search for its name still answers with it, and the result leads to the front page',
    named === 'hackademy.io' &&
      landing?.status === 200 &&
      contentOf(landing.body) === generated('/index.html'),
    `${named || '(no result)'} -> ${followed ?? '(unresolved)'} -> status ${landing?.status ?? '-'}`,
  );
  const tutorial = await searchFor('tutorial');
  check(
    'a search for "tutorial" lists hackademy.io',
    tutorial.includes('href="http://hackademy.io/"'),
    firstResultHost(tutorial) || '(no result)',
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
