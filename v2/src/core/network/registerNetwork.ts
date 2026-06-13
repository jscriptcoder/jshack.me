/**
 * handleRegisterNetwork — the server-side join action (Story 1, slice 1a).
 *
 * When a player connects to a cracked AP, the client's `env.homeNetwork.join`
 * round-trip lands here: it verifies the signed envelope and upserts ONE
 * public-IP registry row so a DIFFERENT identity can later resolve this network
 * by its public IP (`resolvePublicScan`). Today `nmap` only reaches a player's
 * own regenerated LAN; this registry is what makes one identity's scan resolve
 * against another's machine server-side.
 *
 * Server-stamped, never client-claimed:
 *   - `public_ip` is derived from the ESSID ALONE (the WAN address belongs to the
 *     AP, shared by every occupant) — a client cannot register a foreign IP.
 *   - `owner_key` is the verified Ed25519 pubkey, never a payload claim.
 *
 * Degenerate NAT, stored as a VALUE not a shape: `router_machine_id` is the
 * workstation itself and `forward_table` forwards everything to it. Story 5 swaps
 * the value for real PREROUTING/DNAT rules (the router becomes a distinct machine,
 * specific public ports map to specific internal machines) with NO schema change.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { assignHomeNetwork } from './homeNetwork';
import type { NonceStore } from '../signedRequest/nonceStore';

/** One NAT port-forward rule. Degenerate today (`publicPort: '*'` forwards every
 *  port to the one internal machine); Story 5 makes these specific
 *  `{ publicPort: 22, targetMachineId }` entries across multiple internal hosts. */
export type ForwardRule = {
  readonly publicPort: number | '*';
  readonly targetMachineId: string;
};

/** A row in the public-IP registry: `public_ip → network/router/machines`. */
export type NetworkRegistryRow = {
  readonly public_ip: string;
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly router_machine_id: string;
  readonly forward_table: readonly ForwardRule[];
  readonly essid: string;
};

export type RegisterNetworkDeps = {
  readonly nonceStore: NonceStore;
  readonly upsertRegistry: (row: NetworkRegistryRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied `player_key`/`public_ip` — the server stamps
// `owner_key` from the verified pubkey and derives `public_ip` from the essid.
const registerNetworkSchema = z
  .looseObject({
    action: z.literal('registerNetwork'),
    essid: z.string().min(1),
    workstation_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload) && !('public_ip' in payload));

export const handleRegisterNetwork = async (
  body: unknown,
  deps: RegisterNetworkDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, registerNetworkSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The public IP is seeded by the essid alone (see `assignHomeNetwork`), so every
  // occupant of an AP registers the same WAN address under their own owner_key.
  const publicIp = assignHomeNetwork(publicKey, payload.essid).publicIp;
  const row: NetworkRegistryRow = {
    public_ip: publicIp,
    owner_key: publicKey,
    workstation_machine_id: payload.workstation_machine_id,
    router_machine_id: payload.workstation_machine_id,
    forward_table: [{ publicPort: '*', targetMachineId: payload.workstation_machine_id }],
    essid: payload.essid,
  };

  const { error } = await deps.upsertRegistry(row);
  if (error) {
    return { status: 500, body: { error: 'registry_write_failed' } };
  }
  return { status: 200, body: { ok: true } };
};
