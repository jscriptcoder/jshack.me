// Wire-check for A FILE JOB: a contract whose client wants one file brought back from the
// target, mailed to it as an attachment, and checks its bytes. Driven end to end against a
// running `vercel dev` + supabase, staging the job through the REAL `scripts/hireme.ts` and
// working it through the REAL /api endpoints.
//
// Net-new under test (the locally-untypechecked api/ runtime):
//   - THE SERVER LAYS THE FILE: root cracked over :2222 reads the job's signed contract at the
//     path `hireme.ts show` names, root-only, its bytes the ones drawn from this deployment's
//     secret. A contract is the one item a pdf, so the one with line breaks to carry home.
//   - THE CLIENT READS THE ATTACHMENT: a mail with none is asked for the file, one carrying
//     another file is told it is not the one, and neither closes the job.
//   - THE RIGHT BYTES PAY ONCE, UNDER ANY NAME: the file mailed back renamed completes the job
//     and mints the pay; the same file again is told the job is closed and pays nothing more.
//   - A ROOT'S RM STICKS: once removed, the next root to read the box finds no file there.
//
// Usage (with v2 supabase + vercel dev running on 3100):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testMissionFile.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env or an unusable world.

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign.js';
import type { Identity } from '../src/core/commands/types.js';
import { generateIdentityIn } from '../src/test/factories/identityIn.js';
import { computeWorkstationId } from '../src/core/identity/workstation.js';
import { computeApGatewayId } from '../src/core/identity/router.js';
import { generateHomeLan } from '../src/core/generation/generateHomeLan.js';
import { wifiPoolOf } from '../src/core/generation/generateWifi.js';
import { machineIdForLanHost } from '../src/core/generation/lanTopology.js';
import { RIDGEMONT } from '../src/core/generation/world.js';
import { md5 } from '../src/core/generation/md5.js';
import {
  DEFAULT_WORDLIST,
  WORDLIST_PATH,
  formatWordlist,
} from '../src/core/wordlist/defaultWordlist.js';
import { deserializeTree, type SerializedDirectory } from '../src/core/filesystem/treeCodec.js';
import type { Directory, FileNode } from '../src/core/filesystem/types.js';
import { missionShape } from '../src/core/missions/missionShape.js';
import { missionTerms } from '../src/core/missions/missionTerms.js';
import {
  missionFileContent,
  missionFileItem,
  missionFilePath,
} from '../src/core/missions/missionFileItem.js';
import {
  isMissionNumber,
  missionAddressForNumber,
  missionEssid,
} from '../src/core/missions/missionNetwork.js';

const NETWORK = process.env.NETWORK_ENDPOINT ?? 'http://localhost:3100/api/network';
const SESSIONS = process.env.SESSIONS_ENDPOINT ?? 'http://localhost:3100/api/sessions';
const PATCHES = process.env.PATCHES_ENDPOINT ?? 'http://localhost:3100/api/patches';
const WALLET = process.env.WALLET_ENDPOINT ?? 'http://localhost:3100/api/wallet';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missionSecret = process.env.MISSION_KEY_SECRET;

if (!url || !serviceKey || !missionSecret) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISSION_KEY_SECRET');
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

const field = (body: unknown, name: string): unknown =>
  (body as Record<string, unknown> | null)?.[name];

const crackedOf = (body: unknown): readonly { username: string; password: string }[] =>
  (field(body, 'cracked') ?? []) as readonly { username: string; password: string }[];

// `shell: true` so Windows resolves `npx.cmd`; the args carry no spaces, so quoting is moot.
const runHireme = (args: readonly string[]): string =>
  execFileSync('npx', ['tsx', 'scripts/hireme.ts', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();

const SSH_PORT = 2222;
const RUN = Date.now().toString(36).slice(-6);

/** A single-hop file job asking for a signed contract, whose target falls to hydra, so its root
 *  is on every player's list. */
const fileJobNumber = (from: number): number => {
  for (let candidate = from; candidate < from + 60000; candidate += 1) {
    if (!isMissionNumber(candidate)) continue;
    const shape = missionShape(candidate);
    if (missionFileItem(candidate).noun !== 'signed contract') continue;
    if (shape.kind === 'file' && shape.frontBox === null && shape.keyBox.route === 'hydra') {
      return candidate;
    }
  }
  throw new Error(`no single-hop hydra signed-contract job from ${from}`);
};

const JOB = fileJobNumber(600000);
const ESSID = missionEssid(JOB);
const LAN = generateHomeLan(ESSID);
const TARGET_HOST = LAN.hosts.find(
  (host) => host.ip === `${LAN.subnet}.${missionShape(JOB).keyBox.octet}`,
);
if (TARGET_HOST === undefined) {
  console.error(`no target host on ${ESSID}`);
  process.exit(2);
}
const TARGET = machineIdForLanHost(TARGET_HOST, ESSID);
const GATEWAY = computeApGatewayId(ESSID);
const ADDRESS = missionAddressForNumber(JOB) ?? '';
const HANDLE = `file${RUN}`;
const TERMS = missionTerms(JOB);
const FILE_PATH = missionFilePath(JOB);
const FILE = missionFileContent(JOB, missionSecret);
const WALLET_ADDRESS = `jsc${md5(`${RUN}:${JOB}`)}${md5(String(JOB)).slice(0, 8)}`;

/** What a pdf has and the other items lack, so carrying the contract proves it survives. */
const LINE_BREAK = String.fromCharCode(10);

const NO_FILE = 'No file, no money. Send the file.';
const WRONG_FILE = "That's not the file we asked for.";
const CLOSED = 'That job is already closed.';

const contractor = generateIdentityIn(RIDGEMONT);
const [homeEssid] = wifiPoolOf(RIDGEMONT);
const workstationOf = (player: Identity): string =>
  computeWorkstationId('newbie', player.publicKeyHex);

const seedWordlist = async (player: Identity) => {
  const { error } = await sr.from('patches').upsert(
    {
      machine_id: workstationOf(player),
      path: WORDLIST_PATH,
      writer_key: player.publicKeyHex,
      content: formatWordlist(DEFAULT_WORDLIST),
      owner: 'root',
      node_type: 'file',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
    },
    { onConflict: 'machine_id,path,writer_key' },
  );
  if (error) throw new Error(`seed of the word list failed: ${error.message}`);
};

const joinHome = async (player: Identity): Promise<number> => {
  const joined = await post(
    NETWORK,
    signRequest(player, 'registerNetwork', {
      essid: homeEssid,
      workstation_machine_id: workstationOf(player),
      workstation_username: 'newbie',
      workstation_machine_name: 'newbie',
      workstation_root_hash: md5('newbie-root-secret'),
    }),
  );
  return joined.status;
};

/** The contractor sweeps the target behind :2222 for root and logs in as it over ssh. */
const rootOver2222 = async () => {
  const sweep = await post(
    SESSIONS,
    signRequest(contractor, 'hydraCrack', {
      essid: homeEssid,
      target_ip: ADDRESS,
      service: 'ssh',
      caller_machine_id: workstationOf(contractor),
      port: SSH_PORT,
    }),
  );
  const root = crackedOf(sweep.body).find(({ username }) => username === 'root');
  const shell = await post(
    SESSIONS,
    signRequest(contractor, 'authCreateSessionPublic', {
      session_id: `ssh-file-${RUN}`,
      target: ADDRESS,
      port: SSH_PORT,
      username: 'root',
      password: root?.password ?? '',
      parent_session_id: null,
      source_ip: null,
      kind: 'ssh',
    }),
  );
  return {
    landedOn: field(shell.body, 'machine_id'),
    detail: `sweep ${sweep.status} root ${root === undefined ? 'missing' : 'found'}, ssh ${shell.status}`,
  };
};

const nodeAt = (tree: Directory, path: string): FileNode | undefined =>
  path
    .split('/')
    .filter((segment) => segment !== '')
    .reduce<FileNode | undefined>(
      (node, name) => (node?.kind === 'directory' ? node.entries.get(name) : undefined),
      tree,
    );

/** The target as the contractor's root session reads it. */
const targetAsRoot = async (): Promise<{ status: number; file: FileNode | undefined }> => {
  const viewed = await post(
    NETWORK,
    signRequest(contractor, 'resolveCrossPlayerFs', { machine_id: TARGET }),
  );
  if (viewed.status !== 200) return { status: viewed.status, file: undefined };
  const tree = deserializeTree((viewed.body as { tree: SerializedDirectory }).tree);
  return { status: viewed.status, file: nodeAt(tree, FILE_PATH) };
};

/** The contractor's mail to the client, carrying `attachment` when there is one. */
const mailClient = (
  body: string,
  attachment?: { readonly name: string; readonly content: string },
) =>
  post(
    NETWORK,
    signRequest(contractor, 'resolveMail', {
      op: 'send',
      password: 's3cret',
      handle: HANDLE,
      to: TERMS.client.handle,
      subject: 'the file',
      body,
      ...(attachment === undefined ? {} : { attachment }),
    }),
  );

/** The last mail in the handle's inbox, which is the client's answer to the last send. */
const lastReply = async (): Promise<string> => {
  const { data, error } = await sr
    .from('email_messages')
    .select('body')
    .eq('handle', HANDLE)
    .order('number', { ascending: false })
    .limit(1);
  if (error) throw new Error(`inbox read failed: ${error.message}`);
  return ((data ?? []) as readonly { body: string }[])[0]?.body ?? '';
};

const stateOf = async (): Promise<string | null> => {
  const { data } = await sr.from('hireme_missions').select('state').eq('number', JOB).maybeSingle();
  return (data as { state?: string } | null)?.state ?? null;
};

const balanceOf = async (address: string): Promise<number> => {
  const answer = await post(WALLET, { action: 'balance', address });
  const balance = field(answer.body, 'balance');
  return typeof balance === 'number' ? balance : -1;
};

const cleanup = async () => {
  await sr.from('hireme_missions').delete().eq('number', JOB);
  await sr.from('email_accounts').delete().eq('signed_up_by', contractor.publicKeyHex);
  await sr.from('email_sends').delete().eq('player_key', contractor.publicKeyHex);
  for (const machineId of [workstationOf(contractor), TARGET, GATEWAY]) {
    await sr.from('patches').delete().eq('machine_id', machineId);
  }
  await sr.from('sessions').delete().eq('player_key', contractor.publicKeyHex);
  await sr.from('home_network_occupants').delete().eq('owner_key', contractor.publicKeyHex);
  await sr.from('network_lan_leases').delete().eq('owner_key', contractor.publicKeyHex);
  await sr.from('wallet_transfers').delete().eq('to_address', WALLET_ADDRESS);
  await sr.from('wallet_balances').delete().eq('address', WALLET_ADDRESS);
};

const main = async () => {
  await seedWordlist(contractor);
  const joined = await joinHome(contractor);
  if (joined !== 200) throw new Error(`joining the home network failed: ${joined}`);
  const { error } = await sr.from('email_accounts').insert({
    handle: HANDLE,
    password_md5: md5('s3cret'),
    signed_up_by: contractor.publicKeyHex,
  });
  if (error) throw new Error(`mailbox insert failed: ${error.message}`);
  runHireme(['accept', HANDLE, '--number', String(JOB)]);
  console.log(`file job ${JOB} at ${ADDRESS}, the file at ${FILE_PATH}`);

  // 1. hireme.ts show NAMES THE ITEM AND ITS FILE.
  const shown = runHireme(['show', ADDRESS]).split('\n');
  check(
    'hireme.ts show names the item, the file, its path and its size',
    shown.includes('  Kind:     file, signed contract') &&
      shown.includes(`  File:     ${FILE_PATH}, ${FILE.length.toLocaleString('en-US')} bytes`),
    JSON.stringify(shown.filter((line) => /Kind|File/.test(line))),
  );

  // 2. THE SERVER LAYS THE FILE.
  const rooted = await rootOver2222();
  check(
    "hydra cracks the target's root over :2222, and ssh lands root on the target",
    rooted.landedOn === TARGET,
    rooted.detail,
  );
  const laid = await targetAsRoot();
  check(
    "root reads the signed contract at its path, every byte the secret's, line breaks and all",
    FILE.includes(LINE_BREAK) && laid.file?.kind === 'file' && laid.file.content === FILE,
    `status ${laid.status}, ${laid.file?.kind === 'file' ? laid.file.content.length : 0} of ${FILE.length} chars`,
  );
  check(
    'the file is root-only and owned by root',
    laid.file?.kind === 'file' &&
      laid.file.owner === 'root' &&
      JSON.stringify(laid.file.perms.read) === '["root"]' &&
      JSON.stringify(laid.file.perms.write) === '["root"]',
    JSON.stringify(laid.file?.kind === 'file' ? [laid.file.owner, laid.file.perms] : null),
  );

  // 3. THE CLIENT READS THE ATTACHMENT.
  const none = await mailClient(`here it is\n${WALLET_ADDRESS}\n`);
  check(
    'a mail carrying no file is asked for the file, and the job stays open',
    none.status === 200 &&
      (await lastReply()).startsWith(NO_FILE) &&
      (await stateOf()) === 'accepted',
    `status ${none.status}, ${await stateOf()}`,
  );
  const wrong = await mailClient(`here it is\n${WALLET_ADDRESS}\n`, {
    name: FILE_PATH.slice(FILE_PATH.lastIndexOf('/') + 1),
    content: `${FILE}\n`,
  });
  check(
    'a mail carrying the file with a line added is told it is not the file, and pays nothing',
    wrong.status === 200 &&
      (await lastReply()).startsWith(WRONG_FILE) &&
      (await stateOf()) === 'accepted' &&
      (await balanceOf(WALLET_ADDRESS)) <= 0,
    `status ${wrong.status}, ${await stateOf()}`,
  );

  // 4. THE RIGHT BYTES PAY ONCE, UNDER ANY NAME.
  const pay = TERMS.pay;
  const right = await mailClient(`here it is\n${WALLET_ADDRESS}\n`, {
    name: 'holiday.jpg',
    content: FILE,
  });
  check(
    'the file mailed back under another name completes the job and pays the quoted pay',
    right.status === 200 &&
      (await stateOf()) === 'completed' &&
      (await balanceOf(WALLET_ADDRESS)) === pay,
    `status ${right.status}, ${await stateOf()}, balance ${await balanceOf(WALLET_ADDRESS)} (want ${pay})`,
  );
  check(
    'the client says the file was received and names the wallet',
    (await lastReply()).startsWith(
      `File received. §${pay.toLocaleString('en-US')} sent to ${WALLET_ADDRESS}.`,
    ),
    'reply read',
  );
  const again = await mailClient(`once more\n${WALLET_ADDRESS}\n`, {
    name: 'fw.bin',
    content: FILE,
  });
  check(
    'the same file again is told the job is closed and pays nothing more',
    again.status === 200 &&
      (await lastReply()).startsWith(CLOSED) &&
      (await balanceOf(WALLET_ADDRESS)) === pay,
    `status ${again.status}, balance ${await balanceOf(WALLET_ADDRESS)}`,
  );

  // 5. A ROOT'S RM STICKS.
  const removed = await post(
    PATCHES,
    signRequest(contractor, 'removePatch', { machine_id: TARGET, path: FILE_PATH, owner: 'root' }),
  );
  const afterRm = await targetAsRoot();
  check(
    "a root's rm of the file sticks for the next read of the box",
    removed.status === 200 && afterRm.status === 200 && afterRm.file === undefined,
    `rm ${removed.status}, read ${afterRm.status}, file ${afterRm.file === undefined ? 'gone' : 'still there'}`,
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
