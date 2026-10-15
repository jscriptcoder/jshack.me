// Wire-payload smoke for emailit.io's ROOT VIEW of the mail — `resolveCrossPlayerFs`
// on emailit.io's own machine, against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - A ROOT SESSION on emailit.io is served `/etc/emailit/passwd` (one handle:hash
//     line per account) and `/var/mail/<handle>` (one mbox per account), built from
//     the tables. A read message carries `Status: RO`.
//   - A LOWER TIER, AND NO SESSION, are served neither: no table is read and nothing
//     of it reaches the wire.
//   - A JOURNAL ROW SITS OVER THE VIEW: a root's write replaces a mailbox, and the
//     tables are untouched.
//   - WIPING THE JOURNAL, as the restore does, brings the true view back.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMailSpool.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';

type Identity = ReturnType<typeof generateIdentity>;

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
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

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const contentAt = (tree: Directory, ...segments: readonly string[]): string | undefined => {
  const node = nodeAt(tree, ...segments);
  return node?.kind === 'file' ? node.content : undefined;
};

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);

/** Every player this run made, so their accounts can be removed afterwards. */
const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentity();
  players.push(player);
  return player;
};

const signUp = async (player: Identity, handle: string) => {
  const signedUp = await post(
    NETWORK,
    signRequest(player, 'resolveHttpFetch', {
      target: EMAILIT_IP,
      port: 80,
      path: '/signup',
      body: `handle=${handle}&password=s3cret`,
    }),
  );
  if (signedUp.status !== 200) throw new Error(`sign-up of ${handle} failed: ${signedUp.status}`);
};

const readMail = (player: Identity, handle: string, number: number) =>
  post(
    NETWORK,
    signRequest(player, 'resolveMail', {
      op: 'read',
      handle,
      password: 's3cret',
      number,
      mark: true,
    }),
  );

const listMail = (player: Identity, handle: string) =>
  post(NETWORK, signRequest(player, 'resolveMail', { op: 'list', handle, password: 's3cret' }));

/** Put the caller on a session of emailit.io's box at `userType`, the row an ssh hop
 *  would leave. Deleted first so no stale row survives. */
const seedSession = async (player: Identity, userType: 'root' | 'user' | 'guest') => {
  await sr.from('sessions').delete().eq('player_key', player.publicKeyHex);
  const { error } = await sr.from('sessions').insert({
    session_id: `ssh-spool-${userType}-${RUN}`,
    player_key: player.publicKeyHex,
    machine_id: EMAILIT_MACHINE,
    credentials: { username: userType, userType },
    kind: 'ssh',
    essid: EMAILIT_NETWORK,
  });
  if (error) throw new Error(`session seed failed: ${error.message}`);
};

const readBox = async (player: Identity): Promise<{ status: number; tree: Directory | null }> => {
  const result = await post(
    NETWORK,
    signRequest(player, 'resolveCrossPlayerFs', {
      machine_id: EMAILIT_MACHINE,
    }),
  );
  const tree =
    result.status === 200
      ? deserializeTree((result.body as { tree: SerializedDirectory }).tree)
      : null;
  return { status: result.status, tree };
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
    await sr.from('sessions').delete().in('player_key', keys);
  }
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE);
};

const main = async () => {
  if (EMAILIT_IP === '') {
    console.error('emailit.io has no address');
    process.exit(2);
  }
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE);

  const neo = newPlayer();
  const trin = newPlayer();
  const neoHandle = `neo${RUN}`;
  const trinHandle = `trin${RUN}`;
  await signUp(neo, neoHandle);
  await signUp(trin, trinHandle);
  // neo reads the welcome mail, so its Status mark can be seen; trin leaves theirs unread.
  await readMail(neo, neoHandle, 1);

  const neoHash = (
    await sr.from('email_accounts').select('password_md5').eq('handle', neoHandle).single()
  ).data?.password_md5;

  // 1. A ROOT SESSION sees the view.
  const root = newPlayer();
  await seedSession(root, 'root');
  const asRoot = await readBox(root);
  const passwd = asRoot.tree ? (contentAt(asRoot.tree, 'etc', 'emailit', 'passwd') ?? '') : '';
  check(
    'root is served /etc/emailit/passwd with a handle:hash line per account',
    asRoot.status === 200 &&
      passwd.includes(`${neoHandle}:${neoHash}\n`) &&
      passwd.includes(`${trinHandle}:`),
    `status ${asRoot.status}; passwd has ${passwd.split('\n').filter(Boolean).length} line(s)`,
  );
  const neoBox = asRoot.tree ? (contentAt(asRoot.tree, 'var', 'mail', neoHandle) ?? '') : '';
  check(
    "root is served every account's mailbox, the read one marked",
    neoBox.includes('Subject: Welcome to emailit.io') && neoBox.includes('\nStatus: RO\n'),
    `neo's mailbox is ${neoBox.length} byte(s)`,
  );
  const trinBox = asRoot.tree ? (contentAt(asRoot.tree, 'var', 'mail', trinHandle) ?? '') : '';
  check(
    'an unread message has no Status line',
    trinBox.includes('Subject: Welcome to emailit.io') && !trinBox.includes('Status: RO'),
    `trin's mailbox is ${trinBox.length} byte(s)`,
  );

  // 2. A LOWER TIER, AND NO SESSION, see neither.
  const peon = newPlayer();
  await seedSession(peon, 'guest');
  const asGuest = await readBox(peon);
  check(
    'a guest session is served neither /var/mail nor /etc/emailit',
    asGuest.status === 200 &&
      asGuest.tree !== null &&
      nodeAt(asGuest.tree, 'var', 'mail') === undefined &&
      nodeAt(asGuest.tree, 'etc', 'emailit') === undefined,
    `status ${asGuest.status}`,
  );

  const stranger = newPlayer();
  const asNone = await readBox(stranger);
  check(
    'a caller with no session reads nothing of the mail',
    asNone.status === 404 && asNone.tree === null,
    `status ${asNone.status}`,
  );

  // 3. A ROOT WRITE SITS OVER THE VIEW.
  const forged = await post(
    PATCHES,
    signRequest(root, 'upsertPatch', {
      machine_id: EMAILIT_MACHINE,
      path: `/var/mail/${neoHandle}`,
      content: 'FORGED\n',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      node_type: 'file',
      is_new: true,
    }),
  );
  const afterWrite = await readBox(root);
  check(
    "a root's write replaces the mailbox for the next root reader",
    forged.status === 200 &&
      afterWrite.tree !== null &&
      contentAt(afterWrite.tree, 'var', 'mail', neoHandle) === 'FORGED\n',
    `write status ${forged.status}`,
  );
  check(
    'but the real inbox is untouched: neo still lists and reads it',
    (await listMail(neo, neoHandle)).status === 200,
    'neo lists their inbox',
  );

  // 4. WIPING THE JOURNAL BRINGS THE VIEW BACK.
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE);
  const restored = await readBox(root);
  check(
    'with the journal wiped, the true mailbox is back',
    restored.tree !== null &&
      (contentAt(restored.tree, 'var', 'mail', neoHandle) ?? '').includes(
        'Subject: Welcome to emailit.io',
      ),
    `status ${restored.status}`,
  );

  await cleanup();

  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (error: unknown) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
