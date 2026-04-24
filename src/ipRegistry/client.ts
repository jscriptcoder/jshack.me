import type { AllocateIpRequest } from './types';

// Browser-side wrapper for POST /api/allocate-ip. This is the portability seam:
// if we ever swap the server-side stack (Supabase → elsewhere), only this
// function changes — callers keep their signature.

const ALLOCATE_IP_URL = '/api/allocate-ip';

export const allocatePublicIp = async (
  request: AllocateIpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const response = await fetchImpl(ALLOCATE_IP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
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
