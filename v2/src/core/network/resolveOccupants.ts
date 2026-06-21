/**
 * handleResolveOccupants — the same-LAN occupant-list read (Story 7, slice 7.2a).
 *
 * Answers "who else is on ESSID X?" to a VERIFIED occupant. Where the WAN registry
 * keys on `public_ip` (last-writer-wins on a shared AP), occupancy keys on
 * `(essid, owner_key)` so every occupant coexists — this read is the cross-player
 * state the rest of Story 7 renders (the `nmap` merge, the same-LAN front door).
 *
 * LAN boundary (decision D11): real WiFi means you must be ON the LAN to enumerate
 * it. The caller must hold a live occupancy row for the ESSID (checked against the
 * verified pubkey, never a client claim) — a non-occupant is refused before any list
 * crosses the wire, blocking global occupant enumeration / cross-LAN framing.
 *
 * The caller is always excluded from its own result. Each occupant's LAN IP is
 * RE-DERIVED from `assignHomeNetwork(owner_key, essid)` rather than stored
 * (`minimize-api-projections`): the address is a pure function of the identity + AP,
 * so persisting it would only risk drift. Forgery-safe via the broadcast-hint +
 * signed-refetch lineage (`project_realtime_publish_authorization`).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { assignHomeNetwork } from './homeNetwork';
import type { Ipv4 } from './interfaces';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The narrow occupancy projection the gate + merge need: whose row it is (for the
 *  LAN-boundary check + self-exclusion + LAN-IP re-derivation) and the workstation
 *  the caller will later reach. The stored auth/display fields are NOT read here —
 *  only the same-LAN connect handler (7.4) needs them. */
export type OccupantListRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
};

/** What a fellow occupant learns about another: the machine to reach and where to
 *  reach it. No owner key, username, or hash crosses the wire. */
export type OccupantProjection = {
  readonly workstation_machine_id: string;
  readonly localIp: Ipv4;
};

export type ResolveOccupantsDeps = {
  readonly nonceStore: NonceStore;
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly OccupantListRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity — the caller IS the verified pubkey,
// so an owner_key/player_key in the payload is a forgery attempt.
const resolveOccupantsSchema = z
  .looseObject({
    action: z.literal('resolveOccupants'),
    essid: z.string().min(1),
  })
  .refine((payload) => !('owner_key' in payload) && !('player_key' in payload));

export const handleResolveOccupants = async (
  body: unknown,
  deps: ResolveOccupantsDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveOccupantsSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const occupants = await deps.listOccupantsByEssid(payload.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const rows = occupants.data ?? [];

  // LAN boundary: only a live occupant may enumerate the LAN.
  if (!rows.some((row) => row.owner_key === publicKey)) {
    return { status: 403, body: { error: 'not_an_occupant' } };
  }

  const others: readonly OccupantProjection[] = rows
    .filter((row) => row.owner_key !== publicKey)
    .map((row) => ({
      workstation_machine_id: row.workstation_machine_id,
      localIp: assignHomeNetwork(row.owner_key, payload.essid).localIp,
    }));

  return { status: 200, body: { ok: true, occupants: others } };
};
