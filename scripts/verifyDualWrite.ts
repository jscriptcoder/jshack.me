// One-shot behavior verification for the L2 dual-write SQL functions.
//
// Run against local Supabase to confirm:
//   - upsert with p_dual_write=true projects to BOTH patches and
//     machine_filesystems.
//   - upsert with p_dual_write=false (own-workstation bypass) writes
//     ONLY to patches.
//   - upsert with p_dual_write=true but null permissions skips the
//     machine_filesystems write (NOT NULL guard).
//   - upsert UPDATE on the same key replaces both rows.
//   - remove with p_dual_write=true deletes from BOTH.
//   - remove with prefix cascade deletes descendants from BOTH.
//   - remove with p_dual_write=false leaves machine_filesystems alone.
//
// Usage:
//   npx dotenv -e .env.development.local -- npx tsx scripts/verifyDualWrite.ts
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing required env vars. Run with:\n  npx dotenv -e .env.development.local -- npx tsx scripts/verifyDualWrite.ts',
  );
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const PLAYER = 'player-A';
const REMOTE_MACHINE = '10.0.0.42';
const OWN_WORKSTATION = 'kali-aabbccdd';
const PERMS = { read: ['root', 'user'], write: ['root'], execute: ['root'] };

const results: { readonly name: string; readonly pass: boolean; readonly detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
};

const upsert = (args: {
  player: string;
  machine: string;
  path: string;
  content: string | null;
  owner: string;
  permissions: typeof PERMS | null;
  isNew: boolean;
  nodeType: string;
  dualWrite: boolean;
}) =>
  sr.rpc('upsert_patch_with_fs', {
    p_player_key: args.player,
    p_machine_id: args.machine,
    p_path: args.path,
    p_content: args.content,
    p_owner: args.owner,
    p_permissions: args.permissions,
    p_is_new: args.isNew,
    p_node_type: args.nodeType,
    p_dual_write: args.dualWrite,
  });

const remove = (args: {
  player: string;
  machine: string;
  path: string;
  pathPrefix: string;
  dualWrite: boolean;
}) =>
  sr.rpc('remove_patches_with_fs', {
    p_player_key: args.player,
    p_machine_id: args.machine,
    p_path: args.path,
    p_path_prefix: args.pathPrefix,
    p_dual_write: args.dualWrite,
  });

const patchesAt = async (machine: string, path: string) => {
  const { data } = await sr.from('patches').select('*').eq('machine_id', machine).eq('path', path);
  return data ?? [];
};

const fsAt = async (machine: string, path: string) => {
  const { data } = await sr
    .from('machine_filesystems')
    .select('*')
    .eq('machine_id', machine)
    .eq('path', path);
  return data ?? [];
};

const cleanup = async () => {
  await sr.from('patches').delete().in('machine_id', [REMOTE_MACHINE, OWN_WORKSTATION]);
  await sr.from('machine_filesystems').delete().in('machine_id', [REMOTE_MACHINE, OWN_WORKSTATION]);
};

await cleanup();

// 1. upsert cross-machine, dual_write=true: both tables get the row
{
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/etc/foo',
    content: 'foo-content',
    owner: 'root',
    permissions: PERMS,
    isNew: false,
    nodeType: 'file',
    dualWrite: true,
  });
  const p = await patchesAt(REMOTE_MACHINE, '/etc/foo');
  const f = await fsAt(REMOTE_MACHINE, '/etc/foo');
  check(
    'upsert cross-machine: patches + machine_filesystems both have the row',
    p.length === 1 && f.length === 1 && f[0]?.owner === 'root' && f[0]?.content === 'foo-content',
    `patches.length=${p.length} fs.length=${f.length}`,
  );
}

// 2. upsert own-workstation, dual_write=false: only patches has the row
{
  await upsert({
    player: PLAYER,
    machine: OWN_WORKSTATION,
    path: '/home/foo',
    content: 'self-content',
    owner: 'user',
    permissions: PERMS,
    isNew: false,
    nodeType: 'file',
    dualWrite: false,
  });
  const p = await patchesAt(OWN_WORKSTATION, '/home/foo');
  const f = await fsAt(OWN_WORKSTATION, '/home/foo');
  check(
    'upsert own-workstation: only patches has the row',
    p.length === 1 && f.length === 0,
    `patches.length=${p.length} fs.length=${f.length}`,
  );
}

// 3. upsert dual_write=true with null permissions: only patches (fs requires NOT NULL)
{
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/tmp/no-perms',
    content: 'data',
    owner: 'guest',
    permissions: null,
    isNew: false,
    nodeType: 'file',
    dualWrite: true,
  });
  const p = await patchesAt(REMOTE_MACHINE, '/tmp/no-perms');
  const f = await fsAt(REMOTE_MACHINE, '/tmp/no-perms');
  check(
    'upsert null-permissions: machine_filesystems write skipped',
    p.length === 1 && f.length === 0,
    `patches.length=${p.length} fs.length=${f.length}`,
  );
}

// 4. upsert UPDATE: replaces both rows
{
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/etc/foo',
    content: 'foo-v2',
    owner: 'root',
    permissions: PERMS,
    isNew: false,
    nodeType: 'file',
    dualWrite: true,
  });
  const p = await patchesAt(REMOTE_MACHINE, '/etc/foo');
  const f = await fsAt(REMOTE_MACHINE, '/etc/foo');
  check(
    'upsert UPDATE: both rows reflect the latest content',
    p.length === 1 && p[0]?.content === 'foo-v2' && f.length === 1 && f[0]?.content === 'foo-v2',
    `patches.content=${p[0]?.content} fs.content=${f[0]?.content}`,
  );
}

// 5. remove cross-machine, exact path, dual_write=true: both rows gone
{
  await remove({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/etc/foo',
    pathPrefix: '/etc/foo/',
    dualWrite: true,
  });
  const p = await patchesAt(REMOTE_MACHINE, '/etc/foo');
  const f = await fsAt(REMOTE_MACHINE, '/etc/foo');
  check(
    'remove exact-path dual_write=true: both rows gone',
    p.length === 0 && f.length === 0,
    `patches.length=${p.length} fs.length=${f.length}`,
  );
}

// 6. remove with prefix cascade: descendants disappear in both tables
{
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/var/data/a',
    content: 'a',
    owner: 'root',
    permissions: PERMS,
    isNew: true,
    nodeType: 'file',
    dualWrite: true,
  });
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/var/data/b/c',
    content: 'c',
    owner: 'root',
    permissions: PERMS,
    isNew: true,
    nodeType: 'file',
    dualWrite: true,
  });
  await upsert({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/var/dataXother',
    content: 'sibling',
    owner: 'root',
    permissions: PERMS,
    isNew: true,
    nodeType: 'file',
    dualWrite: true,
  });

  await remove({
    player: PLAYER,
    machine: REMOTE_MACHINE,
    path: '/var/data',
    pathPrefix: '/var/data/',
    dualWrite: true,
  });

  const a = await patchesAt(REMOTE_MACHINE, '/var/data/a');
  const c = await patchesAt(REMOTE_MACHINE, '/var/data/b/c');
  const aFs = await fsAt(REMOTE_MACHINE, '/var/data/a');
  const cFs = await fsAt(REMOTE_MACHINE, '/var/data/b/c');
  const sibling = await patchesAt(REMOTE_MACHINE, '/var/dataXother');
  const siblingFs = await fsAt(REMOTE_MACHINE, '/var/dataXother');
  check(
    'remove prefix cascade: descendants gone in both tables, sibling unaffected',
    a.length === 0 &&
      c.length === 0 &&
      aFs.length === 0 &&
      cFs.length === 0 &&
      sibling.length === 1 &&
      siblingFs.length === 1,
    `descendants_p=${a.length}/${c.length} descendants_fs=${aFs.length}/${cFs.length} sibling_p=${sibling.length} sibling_fs=${siblingFs.length}`,
  );
}

// 7. remove own-workstation, dual_write=false: machine_filesystems untouched
{
  // Pre-populate a row in machine_filesystems for the own-workstation
  // (synthetic — wouldn't normally exist, but proves the bypass)
  await sr.from('machine_filesystems').insert({
    machine_id: OWN_WORKSTATION,
    path: '/home/foo',
    owner: 'user',
    permissions: PERMS,
    node_type: 'file',
    content: 'sentinel',
  });

  await remove({
    player: PLAYER,
    machine: OWN_WORKSTATION,
    path: '/home/foo',
    pathPrefix: '/home/foo/',
    dualWrite: false,
  });

  const p = await patchesAt(OWN_WORKSTATION, '/home/foo');
  const f = await fsAt(OWN_WORKSTATION, '/home/foo');
  check(
    'remove own-workstation dual_write=false: patches gone, machine_filesystems untouched',
    p.length === 0 && f.length === 1 && f[0]?.content === 'sentinel',
    `patches.length=${p.length} fs.length=${f.length} fs.content=${f[0]?.content}`,
  );
}

await cleanup();

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
