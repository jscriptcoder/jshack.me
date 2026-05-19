// Ad-hoc seed helper — invokes /api/join-home-network to create a single
// home_networks row + occupant. Use only when the dev DB has no rows and
// you need one for downstream smoke (e.g. testLookupHomeNetwork.ts).
//
// Not part of the regular smoke suite — running it leaks an occupant row
// owned by a throwaway identity. Safe for dev but don't run against prod.

import './lib/loadEnv';
import { generateIdentity } from '../src/identity/identity';
import { signRequest } from '../src/signedRequest/sign';

const vercelDevUrl = process.env.VERCEL_DEV_URL ?? 'http://localhost:3000';

const identity = generateIdentity();
const envelope = signRequest(identity, 'joinHomeNetwork', {
  essid_template: 'SmokeTestNet',
  density_tier: 'crowded',
  workstation_prefix: 'smoke',
});

const response = await fetch(`${vercelDevUrl}/api/join-home-network`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(envelope),
});
const body: unknown = await response.json();
console.log(`status=${response.status}`);
console.log(JSON.stringify(body, null, 2));
if (response.status !== 200) process.exit(1);
