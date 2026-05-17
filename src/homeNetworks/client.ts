import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';
import {
  joinResultSchema,
  lookupHomeNetworkResultSchema,
  type DensityTier,
  type JoinResult,
  type LookupHomeNetworkResult,
} from './types.js';

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

const LOOKUP_HOME_NETWORK_URL = '/api/lookup-home-network';

// Piece-2b lazy-subscription primitive: resolves a foreign public IP to
// the home_networks row's identity + occupant list. 404 → null (no
// allocated home network at this IP) so callers can swallow the miss and
// treat the IP as unresolvable; other non-2xx propagate so abuse / outage
// signals reach the caller.
//
// Signing is for rate-limit attribution + replay protection — the response
// data itself is anon-public (occupants are already SELECTable by anon per
// listOccupants, and home_networks.public_ip is by definition external-
// facing).
export const lookupHomeNetworkByPublicIp = async (
  identity: Identity,
  publicIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupHomeNetworkResult | null> => {
  const envelope = signRequest(identity, 'lookupHomeNetwork', { public_ip: publicIp });

  const response = await fetchImpl(LOOKUP_HOME_NETWORK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`lookupHomeNetworkByPublicIp failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  const parsed = lookupHomeNetworkResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('lookupHomeNetworkByPublicIp returned malformed response');
  }
  return parsed.data;
};
