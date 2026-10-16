// Wire-payload smoke for CHAINIT.IO — the JSC block explorer answered by the REAL
// /api/network and /api/wallet endpoints against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SITE IS AT ITS ADDRESS. `resolveHttpFetch` at chainit's derived address serves
//     the front page it was generated with, and findit lists it.
//   - A LOOKUP READS THE LEDGER. `/address?a=<address>` is answered from `wallet_balances`
//     and `wallet_transfers` through api/network.ts's own two selects: the balance, and
//     the same latest-20 history `/api/wallet` hands `wallet history`, line for line.
//   - AN UNSEEN ADDRESS WRITES NOTHING, and text that is not an address is refused with
//     the form.
//   - THE LOOKUP IS LOGGED in chainit's own access.log, address and visitor both.
//   - THE WHOLE CHAIN IS LISTED. `/recent` is the latest 20 transfers on the chain and
//     `/rich` the 20 largest non-zero balances, through api/network.ts's two chain-wide
//     selects: newest first, largest first, equal balances by address, an emptied address
//     gone. Both are logged like a lookup.
//   - THE LEDGER IS NOT A FILE. A root's `/var/www/html/address`, `recent` or `rich`
//     changes no view; a bricked chainit answers none; the operator's real
//     `scripts/restoreSite.ts chainit.io` brings them back.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testChainit.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { crackableEssidPool } from '../src/core/generation/generateWifi.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { CHAINIT_NETWORK, FINDIT_DOMAIN, fixedSite } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';
import { CHAINIT_FRONT_PAGE } from '../src/core/chainit/pages.js';
import { generateWalletKey } from '../src/core/wallet/walletKey.js';
import { historyLine, ledgerTime } from '../src/core/wallet/historyLine.js';
import type { TransferRecord } from '../src/core/wallet/handleWalletHistory.js';
import { apGatewayLogWriterKey } from '../src/core/logging/apGatewayLogWriter.js';
import { md5 } from '../src/core/generation/md5.js';
import { publicAddressOf } from './publicAddressOf.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const site = fixedSite(CHAINIT_NETWORK);
const SITE_IP = siteAddress('chainit.io');
if (site === undefined || SITE_IP === undefined) {
  console.error('chainit.io answers nowhere — the world is unusable.');
  process.exit(2);
}
const machineId = computeApGatewayId(site.key);
const logKey = apGatewayLogWriterKey(site.key);

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

const contentOf = (body: unknown): string => {
  const content = (body as { content?: unknown } | null)?.content;
  return typeof content === 'string' ? content : '';
};

/** chainit's access log, as the system writes it: under the network's own key. */
const accessLog = async (): Promise<string> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('machine_id', machineId)
    .eq('path', '/var/log/access.log')
    .eq('writer_key', logKey)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? '';
};

/** The address of the first result on a findit results page, as a reader would follow it. */
const firstResultHost = (resultsPage: string): string =>
  /<li>\s*<h2><a href="http:\/\/([^/"]+)\//.exec(resultsPage)?.[1] ?? '';

/** The address at the other end of a line, as the explorer links it. */
const linked = (address: string): string => `<a href="/address?a=${address}">${address}</a>`;

/** The lines of a view's one `<pre>`, as a reader sees them laid out. */
const ledgerLines = (page: string): readonly string[] =>
  (/<pre>([\s\S]*?)<\/pre>/.exec(page)?.[1] ?? '').split('\n').filter((line) => line !== '');

// Minted 500, then sent 40 to PAID; BUSY is minted to more often than a history holds;
// UNSEEN is never touched. The two TIED are minted the same, more than anybody held,
// and EMPTIED is minted less and sends it all to PAID: the top of the rich list.
const FUNDED = generateWalletKey().address;
const PAID = generateWalletKey().address;
const BUSY = generateWalletKey().address;
const UNSEEN = generateWalletKey().address;
const TIED = [generateWalletKey().address, generateWalletKey().address].sort();
const EMPTIED = generateWalletKey().address;
const EVERY_ADDRESS = [FUNDED, PAID, BUSY, UNSEEN, ...TIED, EMPTIED];
const BUSY_MINTS = 25;

const visitor = generateIdentity();
const [visitorEssid] = crackableEssidPool;

const cleanup = async () => {
  await sr.from('wallet_transfers').delete().in('to_address', EVERY_ADDRESS);
  await sr.from('wallet_transfers').delete().in('from_address', EVERY_ADDRESS);
  await sr.from('wallet_balances').delete().in('address', EVERY_ADDRESS);
  await sr.from('sessions').delete().eq('player_key', visitor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', visitor.publicKeyHex);
  await sr.from('patches').delete().eq('machine_id', machineId);
};

/** A row a root's write would leave in chainit's journal, seeded via service_role: no
 *  root-tier hole is open on the site's schedule today. A null content is an `rm`: the
 *  deletion marker stays a 'file' row, as `removePatch` writes it. */
const seedRootWrite = async (path: string, content: string | null) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: machineId,
      path,
      content,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: visitor.publicKeyHex,
      is_new: false,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed of ${path} failed: ${error.message}`);
};

const main = async () => {
  console.log(`chainit.io answers at ${SITE_IP} (machine ${machineId})`);
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

  const minted = await sr.rpc('wallet_mint', { mint_to: FUNDED, mint_amount: 500 });
  const sent = await sr.rpc('wallet_transfer', {
    transfer_from: FUNDED,
    transfer_to: PAID,
    transfer_amount: 40,
    transfer_sequence: 0,
  });
  for (let mint = 0; mint < BUSY_MINTS; mint++) {
    await sr.rpc('wallet_mint', { mint_to: BUSY, mint_amount: mint + 1 });
  }
  if (minted.error || sent.data !== 'moved') {
    console.error(`Could not fund the ledger: ${minted.error?.message ?? String(sent.data)}`);
    process.exit(2);
  }
  const { data: topRow } = await sr
    .from('wallet_balances')
    .select('balance')
    .order('balance', { ascending: false })
    .limit(1)
    .maybeSingle();
  const top = (topRow as { balance?: number } | null)?.balance ?? 0;
  const tiedBalance = top + 1000;
  const emptiedAmount = top + 500;
  for (const tied of TIED) {
    await sr.rpc('wallet_mint', { mint_to: tied, mint_amount: tiedBalance });
  }
  await sr.rpc('wallet_mint', { mint_to: EMPTIED, mint_amount: emptiedAmount });
  const emptied = await sr.rpc('wallet_transfer', {
    transfer_from: EMPTIED,
    transfer_to: PAID,
    transfer_amount: emptiedAmount,
    transfer_sequence: 0,
  });
  if (emptied.data !== 'moved') {
    console.error(`Could not empty an address: ${String(emptied.data)}`);
    process.exit(2);
  }

  const fetchFrom = (target: string, path: string) =>
    post(NETWORK, signRequest(visitor, 'resolveHttpFetch', { target, port: 80, path }));
  const fetchPath = (path: string) => fetchFrom(SITE_IP, path);
  const lookUp = (address: string) => fetchPath(`/address?a=${address}`);
  const FINDIT_IP = siteAddress(FINDIT_DOMAIN) ?? '';
  const searchFor = async (term: string): Promise<string> =>
    contentOf((await fetchFrom(FINDIT_IP, `/?q=${encodeURIComponent(term)}`)).body);

  // 1. THE FRONT PAGE IS SERVED AS GENERATED, AND FINDIT LISTS THE SITE.
  const front = await fetchPath('/');
  check(
    'the front page is served as generated, form and all',
    front.status === 200 && contentOf(front.body) === CHAINIT_FRONT_PAGE,
    contentOf(front.body).slice(0, 80) || `status ${front.status}`,
  );
  const explorer = firstResultHost(await searchFor('explorer'));
  check(
    'a search for an explorer answers with chainit.io first',
    explorer === 'chainit.io',
    explorer,
  );
  check(
    'a search for jsc lists chainit.io',
    (await searchFor('jsc')).includes('href="http://chainit.io/"'),
    'chainit.io in the results',
  );

  // 2. A LOOKUP READS THE LEDGER, AS THE WALLET COMMAND DOES.
  const history = await post(WALLET, { action: 'history', address: FUNDED });
  const transfers =
    (history.body as { transfers?: readonly TransferRecord[] } | null)?.transfers ?? [];
  const funded = await lookUp(FUNDED);
  const fundedPage = contentOf(funded.body);
  const expectedLines = transfers.map((transfer) => historyLine(FUNDED, transfer, linked));
  const linesAt = expectedLines.map((line) => fundedPage.indexOf(line));
  check(
    'a funded address shows its balance and wallet history’s lines, newest first',
    funded.status === 200 &&
      fundedPage.includes(`${FUNDED}  460 JSC`) &&
      transfers.length === 2 &&
      linesAt.every((at, index) => at > -1 && (index === 0 || at > (linesAt[index - 1] ?? -1))),
    `status ${funded.status}; ${expectedLines.length} line(s) at ${JSON.stringify(linesAt)}`,
  );
  check(
    'the address it sent to is a link to its own page, and coinbase is none',
    fundedPage.includes(linked(PAID)) && fundedPage.includes('from coinbase'),
    linked(PAID),
  );
  const busyPage = contentOf((await lookUp(BUSY)).body);
  const busyLines = busyPage.split('\n').filter((line) => line.includes('from coinbase')).length;
  check(
    `an address with ${BUSY_MINTS} transfers shows the latest 20`,
    busyLines === 20 && busyPage.includes(`+${BUSY_MINTS} JSC  from coinbase`),
    `${busyLines} line(s)`,
  );

  // 3. AN UNSEEN ADDRESS HOLDS NOTHING, AND THE LOOKUP WRITES NOTHING.
  const unseenPage = contentOf((await lookUp(UNSEEN)).body);
  const { data: unseenRow } = await sr
    .from('wallet_balances')
    .select('address')
    .eq('address', UNSEEN)
    .maybeSingle();
  check(
    'an address the ledger has never seen shows 0 JSC and no transfers, and gains no row',
    unseenPage.includes(`${UNSEEN}  0 JSC`) &&
      unseenPage.includes('No transfers.') &&
      unseenRow === null,
    `row ${JSON.stringify(unseenRow)}`,
  );

  // 4. TEXT THAT IS NOT AN ADDRESS IS REFUSED WITH THE FORM.
  for (const path of ['/address', '/address?a=hello', `/address?a=${FUNDED.toUpperCase()}`]) {
    const refused = await fetchPath(path);
    check(
      `${path.slice(0, 30)} is not an address`,
      refused.status === 200 && contentOf(refused.body).includes('Not a JSC address: &quot;'),
      `status ${refused.status}`,
    );
  }

  // 5. EVERY LOOKUP IS LOGGED ON CHAINIT, ADDRESS AND VISITOR BOTH.
  const logLine =
    (await accessLog()).split('\n').find((line) => line.includes(`/address?a=${FUNDED}`)) ?? '';
  check(
    'the lookup lands in chainit’s access.log with the address and the visitor’s address',
    logLine.includes(visitorIp) && logLine.includes(' 200 '),
    logLine || '(no line)',
  );

  // 6. THE LATEST TRANSFERS ON THE CHAIN, NEWEST FIRST, BOTH ENDS ON EACH.
  const recent = await fetchPath('/recent');
  const recentLines = ledgerLines(contentOf(recent.body));
  const emptiedHistory = await post(WALLET, { action: 'history', address: EMPTIED });
  const [sentOn] =
    (emptiedHistory.body as { transfers?: readonly TransferRecord[] } | null)?.transfers ?? [];
  check(
    '/recent lists 20 transfers, the latest first, as the wallet times them',
    recent.status === 200 &&
      recentLines.length === 20 &&
      sentOn !== undefined &&
      recentLines[0] ===
        `${ledgerTime(sentOn.at)}  ${emptiedAmount} JSC  ${linked(EMPTIED)} -> ${linked(PAID)}`,
    `status ${recent.status}; ${recentLines.length} line(s); ${recentLines[0] ?? '(none)'}`,
  );
  const mintedTo = recentLines
    .slice(1, 4)
    .map((line) => /coinbase -> <a href="\/address\?a=(jsc[0-9a-f]{40})">/.exec(line)?.[1]);
  check(
    'the mints before it follow in the order they were made, each from coinbase',
    JSON.stringify(mintedTo) === JSON.stringify([EMPTIED, ...[...TIED].reverse()]),
    JSON.stringify(mintedTo),
  );

  // 7. THE RICHEST ADDRESSES, LARGEST FIRST, EQUAL BALANCES BY ADDRESS, NONE EMPTIED.
  const rich = await fetchPath('/rich');
  const richPage = contentOf(rich.body);
  const richLines = ledgerLines(richPage);
  check(
    '/rich ranks the tied addresses first in address order, then the one that was paid',
    rich.status === 200 &&
      richLines.length > 3 &&
      richLines.length <= 20 &&
      JSON.stringify(richLines.slice(0, 3)) ===
        JSON.stringify([
          ` 1  ${linked(TIED[0] ?? '')}  ${tiedBalance} JSC`,
          ` 2  ${linked(TIED[1] ?? '')}  ${tiedBalance} JSC`,
          ` 3  ${linked(PAID)}  ${emptiedAmount + 40} JSC`,
        ]),
    `status ${rich.status}; ${JSON.stringify(richLines.slice(0, 3))}`,
  );
  check(
    'an address emptied by a transfer is not on the rich list',
    !richPage.includes(EMPTIED),
    EMPTIED,
  );

  // 8. EVERY LOOK AT THE CHAIN IS LOGGED ON CHAINIT, VISITOR AND ALL.
  const lines = (await accessLog()).split('\n');
  for (const path of ['/recent', '/rich']) {
    const viewLine = lines.find((line) => line.includes(` ${path} `)) ?? '';
    check(
      `a look at ${path} lands in chainit’s access.log with the visitor’s address`,
      viewLine.includes(visitorIp) && viewLine.includes(' 200 '),
      viewLine || '(no line)',
    );
  }

  // 9. A ROOT'S FILE AT A VIEW'S PATH CHANGES NO VIEW.
  await seedRootWrite('/var/www/html/address', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/recent', '<html>FORGED</html>\n');
  await seedRootWrite('/var/www/html/rich', '<html>FORGED</html>\n');
  const afterForgery = contentOf((await lookUp(FUNDED)).body);
  check(
    'a planted /var/www/html/address changes nothing the explorer says',
    afterForgery.includes(`${FUNDED}  460 JSC`) && !afterForgery.includes('FORGED'),
    afterForgery.slice(0, 60),
  );
  const recentAfterForgery = contentOf((await fetchPath('/recent')).body);
  const richAfterForgery = contentOf((await fetchPath('/rich')).body);
  check(
    'planted /var/www/html/recent and rich change neither view',
    recentAfterForgery.includes(`-> ${linked(PAID)}`) &&
      richAfterForgery.includes(linked(TIED[0] ?? '')) &&
      !recentAfterForgery.includes('FORGED') &&
      !richAfterForgery.includes('FORGED'),
    `${recentAfterForgery.slice(0, 40)} / ${richAfterForgery.slice(0, 40)}`,
  );

  // 10. A BRICKED CHAINIT ANSWERS NO VIEW; THE OPERATOR'S RESTORE BRINGS THEM BACK.
  await seedRootWrite('/boot/vmlinuz', null);
  const bricked = await lookUp(FUNDED);
  const brickedViews = [await fetchPath('/recent'), await fetchPath('/rich')];
  check(
    'a bricked chainit answers no lookup and no view at all',
    [bricked, ...brickedViews].every(
      (dark) =>
        dark.status === 404 &&
        (dark.body as { error?: string } | null)?.error === 'host_unreachable',
    ),
    `status ${bricked.status}, ${brickedViews.map((dark) => dark.status).join(', ')}`,
  );
  const balanceWhileDark = await post(WALLET, { action: 'balance', address: FUNDED });
  check(
    'wallet balance still answers while chainit is dark',
    balanceWhileDark.status === 200 &&
      (balanceWhileDark.body as { balance?: number } | null)?.balance === 460,
    JSON.stringify(balanceWhileDark.body),
  );
  const restored = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/restoreSite.ts', 'chainit.io'],
    { env: process.env, encoding: 'utf8' },
  );
  const afterRestore = await lookUp(FUNDED);
  const frontAfterRestore = await fetchPath('/');
  const viewsAfterRestore = [await fetchPath('/recent'), await fetchPath('/rich')];
  check(
    'restoreSite.ts chainit.io brings back the front page, the lookups and the views',
    restored.status === 0 &&
      afterRestore.status === 200 &&
      contentOf(afterRestore.body).includes(`${FUNDED}  460 JSC`) &&
      contentOf(frontAfterRestore.body) === CHAINIT_FRONT_PAGE &&
      viewsAfterRestore.every((view) => view.status === 200),
    `restore exit ${restored.status}; lookup ${afterRestore.status}; views ${viewsAfterRestore
      .map((view) => view.status)
      .join(', ')}`,
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
