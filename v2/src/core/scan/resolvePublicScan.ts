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
 * Slice 1a reports existence only (host up / down). Slice 1b reads the resolved
 * machine's open ports from its persisted `/var/run/*.pid` rows, scoped to the
 * `workstation_machine_id` — which, after the shared-journal flip, owns its
 * journal (the workstation id encodes the owner), so a machine-scoped read
 * returns the owner's real services, never the caller's per-viewer rows.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';
import { readOpenPortsFromPidfiles } from '../services/pidfile';

/** The registry row field resolution needs: which machine the public IP maps to
 *  (degenerate NAT → the workstation). The machine owns its journal, so reading
 *  its record needs only the machine id. */
export type RegistryLookup = {
  readonly workstation_machine_id: string;
};

/** One of the resolved machine's `/var/run/*.pid` patch rows — the persisted form
 *  of a running service. `readOpenPortsFromPidfiles` turns these into open ports. */
export type RunFileRow = {
  readonly path: string;
  readonly content: string;
};

export type ResolvePublicScanDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryLookup | null; readonly error: unknown }>;
  /** Read the resolved workstation's `/var/run/*.pid` rows. Scoped to
   *  `machine_id` — the shared journal the machine owns — so a cross-player scan
   *  reads the owner's real services, never the caller's own rows. */
  readonly findRunFiles: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly RunFileRow[] | null; readonly error: unknown }>;
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
  if (data === null) {
    return { status: 200, body: { ok: true, found: false, ports: [] } };
  }

  // Found: read the running services off the resolved workstation and report their
  // real ports. Scoped to the machine's own journal so the caller sees the owner's
  // record, not its own per-viewer rows.
  const runFiles = await deps.findRunFiles({
    machine_id: data.workstation_machine_id,
  });
  if (runFiles.error) {
    return { status: 500, body: { error: 'ports_lookup_failed' } };
  }
  const ports = readOpenPortsFromPidfiles(runFiles.data ?? []);
  return { status: 200, body: { ok: true, found: true, ports } };
};
