// Wire-payload smoke for CHANGING A MAIL PASSWORD — `resolveMail` with `op: 'passwd'`
// through the REAL /api/network endpoint against a running `vercel dev` + supabase.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE NEW PASSWORD TAKES OVER. A change with the right old password answers that it
//     changed; the old password then fails, and the new one opens the same inbox with its
//     numbers and read marks as they were.
//   - A WRONG OLD PASSWORD CHANGES NOTHING. It answers `login_failed`, counts as a failed
//     guess against the guesser's key, and the password stays as it was.
//   - A SHORT NEW PASSWORD IS TURNED AWAY BEFORE THE STORE: 400, no failure counted.
//   - THE GUESS THROTTLE HOLDS. With 5 failures in the minute, even the right old password
//     answers `throttled` and changes nothing.
//   - WHOEVER CHANGES IT FIRST KEEPS IT. Two changes at once with the right old password:
//     exactly one changes it, the other is told its login failed.
//   - A DARK EMAILIT.IO CHANGES NOTHING.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMailPasswd.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import { generateIdentity } from '../src/core/identity/identity.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { siteAddress } from '../src/core/generation/publisher.js';
import { EMAILIT_DOMAIN, EMAILIT_NETWORK } from '../src/core/generation/fixedSites.js';
import { WEB_PAGE_FILE } from '../src/core/generation/baseFs.js';

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

/** Every player this run made, so their accounts and failures can be removed afterwards. */
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

const passwd = (player: Identity, handle: string, password: string, newPassword: string) =>
  post(signRequest(player, 'resolveMail', { op: 'passwd', handle, password, newPassword }));

type Listed = { number: number; sender: string; subject: string; read: boolean };

const list = (player: Identity, handle: string, password: string) =>
  post(signRequest(player, 'resolveMail', { op: 'list', handle, password }));

const messagesOf = (body: unknown): readonly Listed[] | undefined =>
  (body as { messages?: readonly Listed[] } | null)?.messages;

const failuresOf = async (player: Identity): Promise<number> => {
  const { count, error } = await sr
    .from('email_login_failures')
    .select('*', { count: 'exact', head: true })
    .eq('player_key', player.publicKeyHex);
  if (error) throw new Error(`failure count failed: ${error.message}`);
  return count ?? 0;
};

const cleanup = async () => {
  const keys = players.map((player) => player.publicKeyHex);
  if (keys.length > 0) {
    await sr.from('email_accounts').delete().in('signed_up_by', keys);
    await sr.from('email_login_failures').delete().in('player_key', keys);
  }
  // The brick, if a failed run left it behind.
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE).eq('path', '/boot/vmlinuz');
};

const main = async () => {
  if (EMAILIT_IP === '') {
    console.error('emailit.io has no address');
    process.exit(2);
  }

  const neo = newPlayer();
  const handle = `neo${RUN}`;
  await signUp(neo, handle);
  // The welcome mail, read before the change, so its mark can be seen to survive it.
  await post(
    signRequest(neo, 'resolveMail', {
      op: 'read',
      handle,
      password: 's3cret',
      number: 1,
      mark: true,
    }),
  );

  // 1. THE NEW PASSWORD TAKES OVER.
  const changed = await passwd(neo, handle, 's3cret', 'n3wer');
  check(
    'a change with the right old password answers that it changed',
    changed.status === 200 && JSON.stringify(changed.body) === '{"ok":true}',
    `status ${changed.status} ${JSON.stringify(changed.body)}`,
  );
  const holder = newPlayer();
  const stale = await list(holder, handle, 's3cret');
  check(
    'the old password no longer opens the inbox, and counts as a failed guess',
    stale.status === 401 &&
      errorOf(stale.body) === 'login_failed' &&
      (await failuresOf(holder)) === 1,
    `status ${stale.status} ${JSON.stringify(stale.body)}`,
  );
  const opened = await list(neo, handle, 'n3wer');
  const [welcome] = messagesOf(opened.body) ?? [];
  check(
    'the new password opens the same inbox, numbers and read marks as they were',
    opened.status === 200 &&
      messagesOf(opened.body)?.length === 1 &&
      welcome?.number === 1 &&
      welcome.read === true,
    `status ${opened.status} ${JSON.stringify(opened.body)}`,
  );

  // 2. A WRONG OLD PASSWORD CHANGES NOTHING.
  const guesser = newPlayer();
  const wrong = await passwd(guesser, handle, 'guess', 'taken');
  check(
    'a wrong old password answers login_failed and counts as a failed guess',
    wrong.status === 401 &&
      errorOf(wrong.body) === 'login_failed' &&
      (await failuresOf(guesser)) === 1,
    `status ${wrong.status} ${JSON.stringify(wrong.body)}`,
  );
  check(
    'and the password stays as it was',
    (await list(neo, handle, 'n3wer')).status === 200 &&
      (await list(neo, handle, 'taken')).status === 401,
    'n3wer still opens it, taken does not',
  );

  // 3. A SHORT NEW PASSWORD IS TURNED AWAY BEFORE THE STORE.
  const before = await failuresOf(neo);
  const short = await passwd(neo, handle, 'n3wer', 'abc');
  check(
    'a 3-character new password is turned away, counting nothing',
    short.status === 400 &&
      errorOf(short.body) === 'payload_invalid' &&
      (await failuresOf(neo)) === before,
    `status ${short.status} ${JSON.stringify(short.body)}`,
  );
  check(
    'and the password stays as it was',
    (await list(neo, handle, 'n3wer')).status === 200,
    'n3wer still opens it',
  );

  // 4. THE GUESS THROTTLE HOLDS.
  const hammer = newPlayer();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await passwd(hammer, handle, `guess${attempt}`, 'taken');
  }
  const held = await passwd(hammer, handle, 'n3wer', 'taken');
  check(
    'with 5 failures in the minute, even the right old password is throttled',
    held.status === 429 && errorOf(held.body) === 'throttled',
    `status ${held.status} ${JSON.stringify(held.body)}`,
  );
  check(
    'and the password stays as it was',
    (await list(neo, handle, 'n3wer')).status === 200,
    'n3wer still opens it',
  );

  // 5. WHOEVER CHANGES IT FIRST KEEPS IT.
  const owner = newPlayer();
  const thief = newPlayer();
  const race = await Promise.all([
    passwd(owner, handle, 'n3wer', 'owners'),
    passwd(thief, handle, 'n3wer', 'thiefs'),
  ]);
  const won = race.filter((attempt) => attempt.status === 200).length;
  const lost = race.filter((attempt) => errorOf(attempt.body) === 'login_failed').length;
  const ownerHolds = (await list(owner, handle, 'owners')).status === 200;
  const thiefHolds = (await list(thief, handle, 'thiefs')).status === 200;
  check(
    'two changes at once: one changes it, the other is told its login failed',
    won === 1 && lost === 1 && ownerHolds !== thiefHolds,
    `${won} changed, ${lost} failed; owner holds ${ownerHolds}, thief holds ${thiefHolds}`,
  );
  const current = ownerHolds ? 'owners' : 'thiefs';

  // 6. A DARK EMAILIT.IO CHANGES NOTHING.
  const { error: brickError } = await sr.from('patches').upsert(
    {
      machine_id: EMAILIT_MACHINE,
      path: '/boot/vmlinuz',
      content: null,
      owner: 'root',
      permissions: WEB_PAGE_FILE,
      node_type: 'file',
      writer_key: neo.publicKeyHex,
      is_new: true,
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (brickError) throw new Error(`brick failed: ${brickError.message}`);
  const dark = await passwd(neo, handle, current, 'darker');
  check(
    'with emailit.io bricked, a change is not made',
    dark.status === 404 && errorOf(dark.body) === 'host_unreachable',
    `status ${dark.status} ${JSON.stringify(dark.body)}`,
  );
  await sr.from('patches').delete().eq('machine_id', EMAILIT_MACHINE).eq('path', '/boot/vmlinuz');
  check(
    'and once it is back, the password is the one it was',
    (await list(neo, handle, current)).status === 200,
    `${current} still opens it`,
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
