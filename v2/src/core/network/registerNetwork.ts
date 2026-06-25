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
 *   - `public_ip` is allocated server-side per ESSID (a globally-unique WAN address
 *     belonging to the AP, shared by every occupant) — a client cannot register a
 *     foreign IP.
 *   - `owner_key` is the verified Ed25519 pubkey, never a payload claim.
 *
 * The router is a DISTINCT machine (Story 5.1): `router_machine_id` is
 * `computeRouterId(owner_key)` — its own seeded box that bears the public IP and
 * runs its own `sshd`. NAT forwards are NOT stored here; the router's
 * `/etc/iptables/rules.v4` is the single parsed source of truth (the old
 * degenerate `forward_table` is gone).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { computeRouterId } from '../identity/router';
import type { NonceStore } from '../signedRequest/nonceStore';

/** A row in the public-IP registry: `public_ip → network/router/machines`. The
 *  `workstation_*` identity fields (Story 2) let the server RECONSTRUCT the owner's
 *  box for a cross-player reader: `username`/`machine_name` are player-chosen;
 *  `root_hash` is `md5(rootPassword)` (the client hashes — the server never sees
 *  plaintext). The guest password is pubkey-seeded, so it is recomputed from
 *  `owner_key` and not stored. */
export type NetworkRegistryRow = {
  readonly public_ip: string;
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly router_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

/** An occupancy row: the same join that writes the WAN registry also records the
 *  player as a live occupant of the ESSID's LAN (Story 7, PK `(essid, owner_key)`).
 *  Unlike `network_registry` (PK `public_ip`, last-writer-wins on a shared AP), this
 *  table is the only place each occupant's workstation identity survives — the
 *  same-LAN connect handler (7.4) auths against it directly. LAN IP/hostname are NOT
 *  stored: they re-derive from `(owner_key, essid)` (`minimize-api-projections`). */
export type HomeNetworkOccupantRow = {
  readonly essid: string;
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

export type RegisterNetworkDeps = {
  readonly nonceStore: NonceStore;
  /** Issue (or recall) the AP's globally-unique public IP for this ESSID. Composed
   *  in the api/ adapter from `allocatePublicIp` over the `network_public_ips`
   *  store; rejects on a store error or allocation exhaustion. */
  readonly allocatePublicIp: (essid: string) => Promise<string>;
  readonly upsertRegistry: (row: NetworkRegistryRow) => Promise<{ readonly error: unknown }>;
  readonly upsertOccupant: (row: HomeNetworkOccupantRow) => Promise<{ readonly error: unknown }>;
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
    workstation_username: z.string().min(1),
    workstation_machine_name: z.string().min(1),
    workstation_root_hash: z.string().min(1),
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

  // The public IP is allocated server-side per ESSID — a globally-unique WAN
  // address belonging to the AP, so every occupant registers the same one under
  // their own owner_key. Allocation precedes the writes; a failure (store error /
  // exhaustion) is a clean 500, never a partial journal write.
  let publicIp: string;
  try {
    publicIp = await deps.allocatePublicIp(payload.essid);
  } catch {
    return { status: 500, body: { error: 'allocation_failed' } };
  }
  const row: NetworkRegistryRow = {
    public_ip: publicIp,
    owner_key: publicKey,
    workstation_machine_id: payload.workstation_machine_id,
    router_machine_id: computeRouterId(publicKey),
    essid: payload.essid,
    workstation_username: payload.workstation_username,
    workstation_machine_name: payload.workstation_machine_name,
    workstation_root_hash: payload.workstation_root_hash,
  };

  const { error } = await deps.upsertRegistry(row);
  if (error) {
    return { status: 500, body: { error: 'registry_write_failed' } };
  }

  // The same join records the player as a live occupant of the ESSID's LAN. Keyed by
  // (essid, owner_key) so every occupant coexists (Story 7) — distinct from the WAN
  // registry's single per-public-IP row.
  const occupant: HomeNetworkOccupantRow = {
    essid: payload.essid,
    owner_key: publicKey,
    workstation_machine_id: payload.workstation_machine_id,
    workstation_username: payload.workstation_username,
    workstation_machine_name: payload.workstation_machine_name,
    workstation_root_hash: payload.workstation_root_hash,
  };
  const occupantWrite = await deps.upsertOccupant(occupant);
  if (occupantWrite.error) {
    return { status: 500, body: { error: 'occupant_write_failed' } };
  }
  return { status: 200, body: { ok: true } };
};
