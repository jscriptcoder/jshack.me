import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import { homeNetworkLookupResultSchema, type HomeNetworkLookupResult } from './types.js';

// Browser-side wrapper for POST /api/lookup-home-network. Mirrors
// joinHomeNetwork in src/homeNetworks/client.ts — same portability seam.
//
// Used by the cross-LAN seed-regen resolver to fetch a foreign
// home_networks row by public IP. Returns null on 404 (not-found is a
// routine outcome — most public IPs are NOT registered home networks).
// Throws on auth/rate-limit/network/server errors.

const LOOKUP_HOME_NETWORK_URL = '/api/lookup-home-network';

export const lookupHomeNetwork = async (
  identity: Identity,
  publicIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HomeNetworkLookupResult | null> => {
  const envelope = signRequest(identity, 'lookupHomeNetwork', { public_ip: publicIp });

  const response = await fetchImpl(LOOKUP_HOME_NETWORK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`lookupHomeNetwork failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  const parsed = homeNetworkLookupResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('lookupHomeNetwork returned malformed response');
  }
  return parsed.data;
};
