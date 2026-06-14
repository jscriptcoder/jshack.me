// One-shot seeder for the slice-2c agent-browser UI E2E: stands up identity A's
// workstation as a cross-player target so a SECOND browser identity (B) can
// `ssh guest@<A.publicIp>` and read A's real files. Registers A via the real
// /api/network endpoint (exercising 2a) and seeds A's owner-scoped patches via
// service_role. Prints what B must type. NOT self-cleaning — run with `clean` to
// remove it afterward.
//
// Usage (with v2 supabase + vercel dev running):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seedCrossPlayerTarget.ts
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seedCrossPlayerTarget.ts clean

import { createClient } from '@supabase/supabase-js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { signRequest } from '../src/core/signedRequest/sign';
import { computeWorkstationId } from '../src/core/identity/workstation';
import { bytesToHex, hexToBytes } from '../src/core/identity/hex';
import { workstationGuestPassword } from '../src/core/generation/workstationFs';
import { assignHomeNetwork } from '../src/core/network/homeNetwork';
import { md5 } from '../src/core/generation/md5';
import { asPlayerKeyHex } from '../src/core/types';
import type { Identity } from '../src/core/commands/types';

ed.hashes.sha512 = sha512;

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:3100/api/network';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

// A FIXED 64-hex private key so the target is reproducible across runs (same
// pubkey → same workstation id, public IP, guest password) and `clean` matches.
const A_PRIV = 'a1b2c3d4'.repeat(8);
const privBytes = hexToBytes(A_PRIV);
if (privBytes === null) throw new Error('bad A private key');
const alice: Identity = {
  publicKeyHex: asPlayerKeyHex(bytesToHex(ed.getPublicKey(privBytes))),
  privateKeyHex: A_PRIV,
};
const ESSID = 'CAFE-DELACROIX-5G';
const A_MACHINE = computeWorkstationId('skylab', alice.publicKeyHex);
const PUBLIC_IP = assignHomeNetwork(alice.publicKeyHex, ESSID).publicIp;
const GUEST_PW = workstationGuestPassword(alice.publicKeyHex);

if (process.argv[2] === 'clean') {
  await sr.from('patches').delete().eq('machine_id', A_MACHINE);
  await sr.from('network_registry').delete().eq('public_ip', PUBLIC_IP);
  console.log('cleaned A’s registry row + patches');
  process.exit(0);
}

// Register A through the real endpoint (server stamps owner_key + public_ip).
const registerRes = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(
    signRequest(alice, 'registerNetwork', {
      essid: ESSID,
      workstation_machine_id: A_MACHINE,
      workstation_username: 'alice',
      workstation_machine_name: 'skylab',
      workstation_root_hash: md5('alice-root-secret'),
    }),
  ),
});
console.log(`registerNetwork → ${registerRes.status}`);

// Seed A's machine-scoped patches (shared journal): guest-readable loot, user-only
// secret, sshd pidfile — all written by A (writer_key = owner).
const worldReadable = { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] };
const userOnly = { read: ['root', 'user'], write: ['root'], execute: ['root'] };
await sr.from('patches').delete().eq('machine_id', A_MACHINE);
await sr.from('patches').insert([
  { writer_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/srv/loot.txt', content: 'OWNED_BY_A', owner: 'root', permissions: worldReadable, node_type: 'file' },
  { writer_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/srv/secret.txt', content: 'TOP_SECRET', owner: 'root', permissions: userOnly, node_type: 'file' },
  { writer_key: alice.publicKeyHex, machine_id: A_MACHINE, path: '/var/run/sshd.pid', content: 'sshd:port=22', owner: 'root', permissions: worldReadable, node_type: 'file' },
]);

console.log('\n=== B should type in the browser ===');
console.log(`  ssh guest@${PUBLIC_IP}`);
console.log(`  password: ${GUEST_PW}`);
console.log(`  then: ls /srv ; cat /srv/loot.txt ; cat /srv/secret.txt ; cat /etc/passwd ; ls /root`);
console.log(`\n(A workstation id: ${A_MACHINE})`);
process.exit(0);
