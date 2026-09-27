// Wire-check for the refusal to overwrite unseen content (POST /api/patches,
// upsertPatch with base_hash).
//
// The rule only means anything against the REAL shared journal: rows are keyed
// (machine_id, path, writer_key), so one file carries a row per writer and the
// guard has to compare against whichever row a reader would materialize. Unit
// tests inject that list; only this proves the query, the ordering and the 409
// survive Supabase and the wire.
//
// Usage (with v2 supabase + vercel dev running):
//   npx dotenv -e .env.development.local -- npx tsx scripts/testModifiedSinceOpen.ts
//
// Exits 0 when all checks pass, 1 on failure, 2 on missing env.

import { createClient } from '@supabase/supabase-js';
import { signRequest } from '../src/core/signedRequest/sign';
import { generateIdentity } from '../src/core/identity/identity';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { contentHash } from '../src/core/patches/contentHash';

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:3100/api/patches';
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
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined;

const contentAt = async (path: string, writerKey: string): Promise<string | null | undefined> => {
  const { data } = await sr
    .from('patches')
    .select('content')
    .eq('writer_key', writerKey)
    .eq('machine_id', machine)
    .eq('path', path);
  return data?.length === 1 ? (data[0]?.content ?? null) : undefined;
};

const id = generateIdentity();
const machine = computeWorkstationId('smoke', id.publicKeyHex);
const RULES = '/etc/iptables/rules.v4';
// A second writer on the SAME machine and path — the shared-journal shape the
// whole rule exists for. Seeded directly, because a real second player would need
// an ssh session this script has no reason to build.
const otherWriter = 'f'.repeat(64);

const TWO_FORWARDS = '# NAT port-forward table\nforward 2222 to 192.168.1.20:22\n';
const THREE_FORWARDS = `${TWO_FORWARDS}forward 4444 to 192.168.1.31:22\n`;

const save = async (
  content: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<{ status: number; body: unknown }> =>
  post(
    signRequest(id, 'upsertPatch', {
      machine_id: machine,
      path: RULES,
      content,
      owner: 'smoke',
      ...extra,
    }),
  );

// 1. The editor's base still matches what the machine holds → the save lands.
await save(TWO_FORWARDS);
const r1 = await save(`${TWO_FORWARDS}# first edit\n`, { base_hash: contentHash(TWO_FORWARDS) });
check(
  'matching base → 200',
  r1.status === 200 && (await contentAt(RULES, id.publicKeyHex)) === `${TWO_FORWARDS}# first edit\n`,
  `status=${r1.status} body=${JSON.stringify(r1.body)}`,
);

// 2. Another occupant writes the same file afterwards, so the editor's base is
// now behind the row a reader materializes.
await sr.from('patches').insert({
  writer_key: otherWriter,
  machine_id: machine,
  path: RULES,
  content: THREE_FORWARDS,
  owner: 'root',
});
const r2 = await save(`${TWO_FORWARDS}# alice was here\n`, {
  base_hash: contentHash(`${TWO_FORWARDS}# first edit\n`),
});
check(
  'base behind ANOTHER writer’s newer row → 409 modified_since_open',
  r2.status === 409 && errorOf(r2.body) === 'modified_since_open',
  `status=${r2.status} error=${errorOf(r2.body)}`,
);

// 3. The whole point: the other occupant's forwards are still there.
check(
  'the refused save left the other writer’s content intact',
  (await contentAt(RULES, otherWriter)) === THREE_FORWARDS,
  `other=${JSON.stringify(await contentAt(RULES, otherWriter))}`,
);
check(
  'the refused save wrote nothing of its own',
  (await contentAt(RULES, id.publicKeyHex)) === `${TWO_FORWARDS}# first edit\n`,
  `own=${JSON.stringify(await contentAt(RULES, id.publicKeyHex))}`,
);

// 4. Naming the content a reader actually sees is accepted — the deliberate
// overwrite stays possible, it just cannot happen blind.
const r4 = await save(`${THREE_FORWARDS}# alice was here\n`, {
  base_hash: contentHash(THREE_FORWARDS),
});
check(
  'base matching the materialized row → 200',
  r4.status === 200,
  `status=${r4.status} body=${JSON.stringify(r4.body)}`,
);

// 5. A write that names no base is unconditional — this is what keeps `>`,
// `touch`, `apt` and the sshd pidfile working exactly as before.
const r5 = await save('# truncated by a redirect\n');
check(
  'no base_hash → 200 regardless of what the machine holds',
  r5.status === 200 &&
    (await contentAt(RULES, id.publicKeyHex)) === '# truncated by a redirect\n',
  `status=${r5.status}`,
);

// 6. A deletion marker holds no content: a save that expects the file to be gone
// agrees with the world, one that expects content does not.
const DELETED = '/etc/snmp/snmpd.conf';
await sr.from('patches').insert({
  writer_key: otherWriter,
  machine_id: machine,
  path: DELETED,
  content: null,
  owner: 'root',
});
const r6a = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path: DELETED,
    content: 'recreated',
    owner: 'smoke',
    is_new: true,
    base_hash: contentHash(''),
  }),
);
const r6b = await post(
  signRequest(id, 'upsertPatch', {
    machine_id: machine,
    path: DELETED,
    content: 'clobbered',
    owner: 'smoke',
    base_hash: contentHash('content this file no longer has'),
  }),
);
check(
  'tombstoned path: expecting absence → 200, expecting content → 409',
  r6a.status === 200 && r6b.status === 409 && errorOf(r6b.body) === 'modified_since_open',
  `is_new=${r6a.status} stale=${r6b.status}/${errorOf(r6b.body)}`,
);

// Cleanup.
await sr.from('patches').delete().eq('machine_id', machine);

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
