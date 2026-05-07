import type { Identity } from '../identity/identity.js';
import { signRequest } from '../signedRequest/sign.js';

// Browser-side wrapper for POST /api/register-workstation. Mirrors the
// pattern in src/sessionRegistry/client.ts: sign envelope, POST, parse
// response. fetch is injectable for testability.
//
// Called once at workstation-creation time from IntroScreen — see the
// `handleSubmit` fire-and-forget after `onStart`. The endpoint is
// idempotent (server returns 200 on a matching repeat); a network
// blip means the player can keep playing while
// scripts/backfillWorkstationBaseFs.ts catches the registration on the
// next operational pass.

const REGISTER_WORKSTATION_URL = '/api/register-workstation';

// seed and rootPassword are part of the registration envelope (added in
// PR 1 of plans/cross-player-base-fs-replication.md). seed is persisted
// in the workstations row server-side; rootPassword is consumed at
// register-time to embed md5(rootPassword) in projected /etc/passwd
// content, then discarded. Required for cross-player password
// validation (PR 2) to compare submitted passwords against the real
// hash.
export type RegisterWorkstationRequest = {
  readonly workstation_name: string;
  readonly username: string;
  readonly seed: string;
  readonly rootPassword: string;
};

export type RegisterWorkstationResult = {
  readonly inserted: boolean;
};

export const registerWorkstation = async (
  identity: Identity,
  request: RegisterWorkstationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterWorkstationResult> => {
  const envelope = signRequest(identity, 'registerWorkstation', { ...request });
  const response = await fetchImpl(REGISTER_WORKSTATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    throw new Error(`registerWorkstation failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    !('inserted' in data) ||
    typeof (data as { readonly inserted: unknown }).inserted !== 'boolean'
  ) {
    throw new Error(
      'registerWorkstation returned malformed response (missing or non-boolean `inserted`)',
    );
  }
  return { inserted: (data as { readonly inserted: boolean }).inserted };
};
