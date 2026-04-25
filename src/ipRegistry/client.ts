import type { Identity } from '../identity/identity.js';
import type { IpKind } from './types.js';
import { signRequest } from '../signedRequest/sign.js';

// Browser-side wrapper for POST /api/allocate-ip. This is the portability seam:
// if we ever swap the server-side stack (Supabase → elsewhere), only this
// function changes — callers keep their signature.
//
// The request is wrapped in a SignedEnvelope (Ed25519). owner_key is not part
// of the client-controlled payload — the server stamps it from the verified
// public key, so a malicious client (Burp/curl) can't allocate IPs in someone
// else's name. See docs/technology-choices.md ("Authenticated requests").

const ALLOCATE_IP_URL = '/api/allocate-ip';

export type AllocateIpClientRequest = {
  readonly kind: IpKind;
  readonly instance_ref?: string;
};

export const allocatePublicIp = async (
  identity: Identity,
  request: AllocateIpClientRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const envelope = signRequest(identity, 'allocateIp', { ...request });

  const response = await fetchImpl(ALLOCATE_IP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    throw new Error(`allocatePublicIp failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('ip' in data)) {
    throw new Error('allocatePublicIp returned malformed response (missing ip)');
  }

  const ip = (data as { readonly ip: unknown }).ip;
  if (typeof ip !== 'string') {
    throw new Error('allocatePublicIp returned malformed response (ip is not a string)');
  }

  return ip;
};
