/**
 * handleRegisterNetwork — the server-side join action.
 *
 * When a player connects to a cracked AP, the client's `env.homeNetwork.join`
 * round-trip lands here: it verifies the signed envelope, leases the player an
 * address on the ESSID's LAN, and records them as an occupant of it. Occupancy is
 * what makes one identity's box reachable by another's `nmap`/`ssh` — every
 * cross-player resolver answers from this row plus the ESSID's public IP.
 *
 * Server-stamped, never client-claimed:
 *   - `public_ip` is never claimed or stored: a network's address is derived from its
 *     place in the world, so a client cannot register a foreign IP.
 *   - `owner_key` is the verified Ed25519 pubkey, never a payload claim.
 *
 * The AP's gateway is a DISTINCT machine and is NOT recorded here: its id derives
 * from the ESSID (`computeApGatewayId`), so every occupant resolves the SAME gateway
 * and they all sit behind one NAT on one public address. NAT forwards are not stored
 * either; the gateway's `/etc/iptables/rules.v4` is the single parsed source of truth.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { lanAddressFor } from './lanAddress.js';
import { declaredNetwork, RIDGEMONT } from '../generation/world.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** An occupancy row: the join records the player as a live occupant of the ESSID's
 *  LAN, keyed `(essid, owner_key)` so every occupant of a shared AP coexists. This is
 *  the only place a player's workstation identity survives, and it is what every
 *  cross-player resolver reads: `username`/`machine_name` are player-chosen and
 *  `root_hash` is `md5(rootPassword)` (the client hashes — the server never sees
 *  plaintext), which together let the server RECONSTRUCT the box for a foreign
 *  reader. The guest password is pubkey-seeded, so it recomputes from `owner_key` and
 *  is not stored; LAN IP and hostname likewise re-derive from `(owner_key, essid)`
 *  (`minimize-api-projections`).
 *
 *  The row's LIFETIME is the reachability rule: it exists exactly while the machine
 *  is on the WiFi, so deleting it on `nmcli disconnect` is what takes the box out of
 *  reach. Nothing about it tracks whether a player is at the keyboard. */
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
  /** Issue (or recall) this occupant's host octet on the ESSID's `/24`. Where the
   *  public IP is ONE address shared by the whole AP, a LAN lease is per
   *  `(essid, owner_key)` — each occupant holds its own, and the `(essid, octet)`
   *  uniqueness that guarantees it is a database constraint. Composed in the api/
   *  adapter from `allocateLanLease` over the `network_lan_leases` store. */
  readonly allocateLanLease: (essid: string, ownerKey: string) => Promise<number>;
  readonly upsertOccupant: (row: HomeNetworkOccupantRow) => Promise<{ readonly error: unknown }>;
  /** Whether a join may reach a network the world does not declare. Only a local
   *  `vercel dev` admits them, so the wire-checks can each join a made-up network whose
   *  gateway nobody has written to. */
  readonly admitsUndeclaredNetworks: boolean;
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

  // Every player lives in Ridgemont until travel exists, so its networks are the only
  // ones a join may reach. Another town's are never offered on WiFi and their keys are
  // guessable, so the client cannot be trusted to stay home. Refused before the lease,
  // so a refused join leaves nothing behind.
  const network = declaredNetwork(payload.essid);
  const joinable =
    network === undefined ? deps.admitsUndeclaredNetworks : network.town === RIDGEMONT;
  if (!joinable) {
    return { status: 403, body: { error: 'network_not_joinable' } };
  }

  // The occupant's own address on that AP's LAN, leased against a uniqueness
  // constraint so two occupants of one ESSID can never hold the same one. It precedes
  // the write: a full subnet or a store failure is a clean 500, never a join that
  // registers a player on a network they hold no address on.
  let leasedOctet: number;
  try {
    leasedOctet = await deps.allocateLanLease(payload.essid, publicKey);
  } catch {
    return { status: 500, body: { error: 'lease_allocation_failed' } };
  }

  // The address is held, so record the player as a live occupant of the ESSID's LAN. Keyed by (essid, owner_key) so every occupant of a shared AP coexists.
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

  // The join TELLS the client where it lives. The address is the lease, not the
  // derivation the client could compute for itself: those agree for everyone whose
  // preferred octet was free, and for a redrawn occupant the derivation is simply
  // wrong. Returning it here is what lets the client stop deriving at all.
  return { status: 200, body: { ok: true, local_ip: lanAddressFor(payload.essid, leasedOctet) } };
};
