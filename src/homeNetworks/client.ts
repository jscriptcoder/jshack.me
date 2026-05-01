import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import { joinResultSchema, type DensityTier, type JoinResult } from './types.js';

// Browser-side wrapper for POST /api/join-home-network. Mirrors
// allocatePublicIp in src/ipRegistry/client.ts — same portability seam: if
// the server stack ever changes (Supabase → other), only this file needs
// to follow.
//
// The signed envelope is the auth + replay protection. player_key is never
// part of the client-controlled payload — the server stamps it from the
// verified public key.

const JOIN_HOME_NETWORK_URL = '/api/join-home-network';

export type JoinHomeNetworkRequest = {
  readonly essid_template: string;
  readonly density_tier: DensityTier;
  readonly workstation_prefix: string;
};

export const joinHomeNetwork = async (
  identity: Identity,
  request: JoinHomeNetworkRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinResult> => {
  const envelope = signRequest(identity, 'joinHomeNetwork', { ...request });

  const response = await fetchImpl(JOIN_HOME_NETWORK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    throw new Error(`joinHomeNetwork failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  const parsed = joinResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('joinHomeNetwork returned malformed response');
  }
  return parsed.data;
};
