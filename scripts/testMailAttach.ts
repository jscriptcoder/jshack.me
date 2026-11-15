// Wire-payload smoke for MAIL THAT CARRIES A FILE — `resolveMail` with an `attachment` on
// `op: 'send'`, answered on `op: 'read'`, through the REAL /api/network endpoint against a
// running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime and the migration):
//   - A FILE ARRIVES BYTE FOR BYTE. Noise of the kind the world's photos are made of is sent
//     with a message and read back unchanged, under its name; a message without one reads
//     with no attachment at all.
//   - THE LIMITS HOLD AT THE DOOR. A file of exactly 8,000 characters goes; 8,001, an empty
//     name and a name that is a path are turned away and deliver nothing.
//   - A DELETE TAKES THE FILE WITH THE MESSAGE. No row is left holding it.
//   - THE ROOT VIEW SHOWS IT AS MIME. emailit.io's root reads the message in the recipient's
//     mbox as multipart/mixed, the file raw in its second part.
//   - A CLIENT IGNORES IT. A mail to a client's handle that carries a file is answered as it
//     would be without one, and nothing is delivered to the client.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMailAttach.ts
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
import { missionTerms } from '../src/core/missions/missionTerms.js';

type Identity = ReturnType<typeof generateIdentity>;

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

const errorOf = (body: unknown): unknown => (body as { error?: unknown } | null)?.error;

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';
const EMAILIT_MACHINE = computeApGatewayId(EMAILIT_NETWORK);

/** A suffix no earlier run used, so every handle here is fresh. */
const RUN = Date.now().toString(36).slice(-6);

/** Noise as the world's photos are made of it: Latin-1 letters and symbols above the range
 *  `strings` keeps, with a readable run in the middle, `length` characters in all. */
const noise = (length: number): string => {
  const run = 'Exif Canon EOS 5D';
  const filler = Array.from({ length: length - run.length }, (_unused, index) =>
    String.fromCharCode(0xa1 + ((index * 37) % 0x5e)),
  ).join('');
  return `${filler.slice(0, 100)}${run}${filler.slice(100)}`;
};
const PHOTO = noise(6000);

const players: Identity[] = [];
const newPlayer = (): Identity => {
  const player = generateIdentity();
  players.push(player);
  return player;
};

const signUp = async (player: Identity, handle: string) => {
  const signedUp = await post(
    signRequest(player, 'resolveHttpFetch', {
      target: EMAILIT_IP,
      port: 80,
      path: '/signup',
      body: `handle=${handle}&password=s3cret`,
    }),
  );
  if (signedUp.status !== 200) throw new Error(`sign-up of ${handle} failed: ${signedUp.status}`);
};

const send = (player: Identity, fields: Record<string, unknown>) =>
  post(
    signRequest(player, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      subject: 'the photo',
      body: 'here it is\n',
      ...fields,
    }),
  );

type Opened = {
  number: number;
  subject: string;
  body: string;
  attachment?: { name: string; content: string };
};

const open = async (player: Identity, handle: string, number: number): Promise<unknown> => {
  const opened = await post(
    signRequest(player, 'resolveMail', {
      op: 'read',
      handle,
      password: 's3cret',
      number,
      mark: false,
    }),
  );
  return (opened.body as { message?: Opened } | null)?.message;
};

const inboxOf = async (
  player: Identity,
  handle: string,
): Promise<readonly { number: number; subject: string }[]> => {
  const listed = await post(
    signRequest(player, 'resolveMail', { op: 'list', handle, password: 's3cret' }),
  );
  return (
    (listed.body as { messages?: readonly { number: number; subject: string }[] } | null)
      ?.messages ?? []
  );
};

const nodeAt = (tree: Directory, ...segments: readonly string[]): FileNode | undefined => {
  let node: FileNode | undefined = tree;
  for (const segment of segments) {
    if (node === undefined || node.kind !== 'directory') return undefined;
    node = node.entries.get(segment);
  }
  return node;
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
    await sr.from('email_sends').delete().in('player_key', keys);
    await sr.from('email_login_failures').delete().in('player_key', keys);
    await sr.from('sessions').delete().in('player_key', keys);
  }
};

const main = async () => {
  if (EMAILIT_IP === '') {
    console.error('emailit.io has no address');
    process.exit(2);
  }

  const neo = newPlayer();
  const trin = newPlayer();
  const from = `neo${RUN}`;
  const to = `trin${RUN}`;
  await signUp(neo, from);
  await signUp(trin, to);

  // 1. A FILE ARRIVES BYTE FOR BYTE.
  const sent = await send(neo, {
    handle: from,
    to,
    attachment: { name: 'IMG_0412.jpg', content: PHOTO },
  });
  check('a send carrying a file answers that it went', sent.status === 200, `${sent.status}`);
  const carried = (await open(trin, to, 2)) as Opened | undefined;
  check(
    'the file reads back under its name, every character as sent',
    carried?.attachment?.name === 'IMG_0412.jpg' && carried.attachment.content === PHOTO,
    `name ${carried?.attachment?.name}, ${carried?.attachment?.content.length} of ${PHOTO.length} chars, equal ${carried?.attachment?.content === PHOTO}`,
  );
  check(
    'the body goes with it as written',
    carried?.body === 'here it is\n',
    JSON.stringify(carried?.body),
  );
  const welcome = (await open(trin, to, 1)) as Opened | undefined;
  check(
    'a message that carries nothing reads with no attachment',
    welcome !== undefined && !('attachment' in welcome),
    JSON.stringify(Object.keys(welcome ?? {})),
  );

  // 2. THE LIMITS HOLD AT THE DOOR.
  const atLimit = await send(neo, {
    handle: from,
    to,
    subject: 'at the limit',
    attachment: { name: 'dump.bin', content: 'x'.repeat(8000) },
  });
  check('a file of exactly 8,000 characters goes', atLimit.status === 200, `${atLimit.status}`);
  const before = (await inboxOf(trin, to)).length;
  for (const [label, attachment] of [
    ['8,001 characters', { name: 'dump.bin', content: 'x'.repeat(8001) }],
    ['an empty name', { name: '', content: 'x' }],
    ['a name that is a path', { name: 'tmp/x.bin', content: 'x' }],
  ] as const) {
    const refused = await send(neo, { handle: from, to, subject: label, attachment });
    check(
      `a file with ${label} is turned away`,
      refused.status === 400 && errorOf(refused.body) === 'payload_invalid',
      `status ${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }
  check(
    'nothing turned away was delivered',
    (await inboxOf(trin, to)).length === before,
    `${before} before, ${(await inboxOf(trin, to)).length} after`,
  );

  // 3. THE ROOT VIEW SHOWS IT AS MIME.
  const root = newPlayer();
  await sr.from('sessions').delete().eq('player_key', root.publicKeyHex);
  const seeded = await sr.from('sessions').insert({
    session_id: `ssh-attach-root-${RUN}`,
    player_key: root.publicKeyHex,
    machine_id: EMAILIT_MACHINE,
    credentials: { username: 'root', userType: 'root' },
    kind: 'ssh',
    essid: EMAILIT_NETWORK,
  });
  if (seeded.error) throw new Error(`session seed failed: ${seeded.error.message}`);
  const viewed = await post(
    signRequest(root, 'resolveCrossPlayerFs', { machine_id: EMAILIT_MACHINE }),
  );
  const tree =
    viewed.status === 200
      ? deserializeTree((viewed.body as { tree: SerializedDirectory }).tree)
      : null;
  const mbox = tree === null ? undefined : nodeAt(tree, 'var', 'mail', to);
  const content = mbox?.kind === 'file' ? mbox.content : '';
  check(
    "root reads the message in the recipient's mbox as multipart/mixed, the file raw",
    content.includes('Content-Type: multipart/mixed; boundary="emailit-2"') &&
      content.includes('Content-Disposition: attachment; filename="IMG_0412.jpg"') &&
      content.includes(PHOTO),
    `status ${viewed.status}; mbox ${content.length} chars`,
  );

  // 4. A DELETE TAKES THE FILE WITH THE MESSAGE.
  const deleted = await post(
    signRequest(trin, 'resolveMail', { op: 'delete', handle: to, password: 's3cret', number: 2 }),
  );
  const { count } = await sr
    .from('email_messages')
    .select('*', { count: 'exact', head: true })
    .eq('handle', to)
    .eq('attachment_name', 'IMG_0412.jpg');
  check(
    'a deleted message leaves no row holding its file',
    deleted.status === 200 && count === 0,
    `status ${deleted.status}, ${count} row(s) left`,
  );

  // 5. A CLIENT IGNORES IT.
  const client = missionTerms(66051).client;
  const toClient = await send(neo, {
    handle: from,
    to: client.handle,
    subject: 'the job',
    attachment: { name: 'IMG_0412.jpg', content: PHOTO },
  });
  const replies = await inboxOf(neo, from);
  check(
    'a mail to a client carrying a file is answered as one without it',
    toClient.status === 200 && replies.some((message) => message.subject === 'No contract'),
    `status ${toClient.status}; neo's subjects ${JSON.stringify(replies.map((m) => m.subject))}`,
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
