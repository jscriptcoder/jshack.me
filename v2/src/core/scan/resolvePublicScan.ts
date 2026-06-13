/**
 * handleResolvePublicScan — server-side resolution of a cross-player public-IP
 * scan (Story 1, slice 1a).
 *
 * Today `nmap` only reaches a player's OWN regenerated LAN; a public IP is "out of
 * range". This handler is what makes one identity's `nmap <public IP>` resolve
 * against ANOTHER identity's machine: it verifies the caller's signed envelope and
 * looks the target up in the public-IP registry written on join
 * (`registerNetwork`). The caller's identity is authenticated (envelope + replay
 * guard) but not otherwise consulted — any authenticated player may scan any
 * public IP, exactly like the real internet.
 *
 * Slice 1a reports existence only (host up / down). Slice 1b extends the found
 * branch to read the resolved machine's open ports from its persisted record,
 * which is why the lookup already projects `owner_key` + `workstation_machine_id`
 * (the keys that read those patches).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The registry row fields resolution needs: which machine the public IP maps to
 *  (degenerate NAT → the workstation) and whose record to read (the owner). */
export type RegistryLookup = {
  readonly workstation_machine_id: string;
  readonly owner_key: string;
};

export type ResolvePublicScanDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryLookup | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const resolvePublicScanSchema = z
  .looseObject({
    action: z.literal('resolvePublicScan'),
    target: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleResolvePublicScan = async (
  body: unknown,
  deps: ResolvePublicScanDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolvePublicScanSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { data, error } = await deps.findRegistryByPublicIp(verified.payload.target);
  if (error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }
  return { status: 200, body: { ok: true, found: data !== null } };
};
